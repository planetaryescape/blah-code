import { createParser, type EventSourceMessage } from "eventsource-parser";
import { createLogger } from "@blah-code/logger";
import Conf from "conf";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { URL } from "node:url";
import open from "open";

export interface TransportMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  schema: unknown;
}

export interface ModelTransport {
  complete(input: {
    messages: TransportMessage[];
    modelId: string;
    tools: ToolSpec[];
    timeoutMs?: number;
    signal?: AbortSignal;
    onDelta?: (chunk: { text: string; done?: boolean }) => void;
  }): Promise<{ text: string }>;
}

export interface BlahTransportOptions {
  apiKey: string;
  baseUrl?: string;
  conversationId?: string;
}

export interface StoredCredentials {
  apiKey: string;
  keyPrefix?: string;
  email?: string;
  name?: string;
  createdAt?: number;
}

interface CliRpcEnvelope<T> {
  status: "success" | "error";
  data?: T;
  error?: string | { message?: string };
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? "https://blah.chat").replace(/\/$/, "");
}

const logger = createLogger("transport.blah");

export class BlahTransport implements ModelTransport {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private conversationId: string | null;

  constructor(options: BlahTransportOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.conversationId = options.conversationId ?? null;
  }

  getConversationId(): string | null {
    return this.conversationId;
  }

  private async cliRpc<T>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 30000,
  ): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort("timeout"), timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v1/cli/rpc`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ method, params }),
        signal: ctrl.signal,
      });
    } catch (error) {
      if (String(error).includes("AbortError") || String(error).includes("timeout")) {
        throw new Error(`RPC ${method} timeout after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    const json = (await res.json()) as CliRpcEnvelope<T>;
    if (!res.ok || json.status === "error") {
      const message =
        typeof json.error === "string"
          ? json.error
          : (json.error?.message ?? `RPC ${method} failed`);
      throw new Error(message);
    }
    return json.data as T;
  }

  private renderPrompt(messages: TransportMessage[], tools: ToolSpec[]): string {
    const toolBlock = JSON.stringify(
      tools.map((t) => ({ name: t.name, description: t.description, schema: t.schema })),
      null,
      2,
    );
    const transcript = messages
      .map((m) => `${m.role.toUpperCase()}:\n${m.content}`)
      .join("\n\n");

    return [
      "You are blah-code local agent brain.",
      "When you need a tool, respond ONLY with JSON:",
      '{"type":"tool_call","tool":"<name>","arguments":{...}}',
      "No markdown fences when calling tools.",
      'When calling a tool: response must start with "{" and end with "}" (no prose before/after).',
      "If no tool needed, provide normal assistant answer.",
      "Available tools:",
      toolBlock,
      "Conversation:",
      transcript,
    ].join("\n\n");
  }

  private async ensureConversation(modelId: string): Promise<string> {
    if (this.conversationId) return this.conversationId;
    const created = await this.cliRpc<{ conversationId: string }>("createConversation", {
      title: "blah-code session",
      model: modelId,
    });
    this.conversationId = created.conversationId;
    return this.conversationId;
  }

  async complete(input: {
    messages: TransportMessage[];
    modelId: string;
    tools: ToolSpec[];
    timeoutMs?: number;
    signal?: AbortSignal;
    onDelta?: (chunk: { text: string; done?: boolean }) => void;
  }): Promise<{ text: string }> {
    if (input.signal?.aborted) {
      throw new Error("Run cancelled by user");
    }

    const conversationId = await this.ensureConversation(input.modelId);
    const prompt = this.renderPrompt(input.messages, input.tools);

    const sent = await this.cliRpc<{ userMessageId: string }>("sendMessage", {
      conversationId,
      content: prompt,
      modelId: input.modelId,
    });

    return await this.waitForAssistant(
      conversationId,
      sent.userMessageId,
      input.timeoutMs ?? 120000,
      input.signal,
      input.onDelta,
    );
  }

  private async waitForAssistant(
    conversationId: string,
    userMessageId: string,
    timeoutMs: number,
    externalSignal?: AbortSignal,
    onDelta?: (chunk: { text: string; done?: boolean }) => void,
  ): Promise<{ text: string }> {
    const ctrl = new AbortController();
    let timedOut = false;
    let doneSignal = false;
    let cancelled = false;
    let streamError: Error | null = null;
    const onExternalAbort = () => {
      cancelled = true;
      ctrl.abort("cancelled");
    };

    if (externalSignal) {
      if (externalSignal.aborted) onExternalAbort();
      else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort("timeout");
    }, timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/api/v1/cli/messages/stream/${conversationId}`, {
        method: "GET",
        headers: {
          accept: "text/event-stream",
          "x-api-key": this.apiKey,
          authorization: `Bearer ${this.apiKey}`,
        },
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`SSE failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let latestText = "";
      let emittedText = "";
      const parser = createParser({
        onEvent: (event: EventSourceMessage) => {
          if (!event.data) return;
          try {
            const payload = JSON.parse(event.data) as {
              status?: string;
              error?: string | { message?: string };
              messages?: unknown;
            };

            const messages: Array<{
                _id: string;
                role: string;
                status?: string;
                content?: string;
                partialContent?: string;
              }> = Array.isArray((payload as any).messages) ? ((payload as any).messages as any) : [];

            if (payload.status === "error") {
              const message =
                typeof payload.error === "string"
                  ? payload.error
                  : (payload.error?.message ?? "Assistant generation failed");
              streamError = new Error(message);
              ctrl.abort("error");
              return;
            }

            const userIndex = messages.findIndex((m) => m._id === userMessageId);
            if (userIndex < 0) return;
            const assistants = messages.slice(userIndex + 1).filter((m) => m.role === "assistant");
            const last = assistants.at(-1);
            if (!last) return;
            const incomingText = last.content || last.partialContent || latestText;
            if (incomingText !== latestText) {
              latestText = incomingText;
            }

            if (onDelta && latestText.length > 0) {
              const chunk = latestText.startsWith(emittedText)
                ? latestText.slice(emittedText.length)
                : latestText;
              if (chunk.length > 0) {
                onDelta({ text: chunk, done: last.status === "complete" });
              }
              emittedText = latestText;
            }

            if (last.status === "complete" && latestText.trim()) {
              doneSignal = true;
              ctrl.abort("done");
            }
            if (last.status === "error") {
              streamError = new Error(last.content || "Assistant generation failed");
              ctrl.abort("error");
            }
          } catch {
            // ignore bad chunks
          }
        },
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
        if (streamError) {
          throw streamError;
        }
      }

      if (streamError) {
        throw streamError;
      }

      if (!latestText.trim()) {
        throw new Error("No assistant response received");
      }
      return { text: latestText };
    } catch (err) {
      if (timedOut) {
        logger.warn({
          conversationId,
          userMessageId,
          timeoutMs,
        }, "model wait timed out");
        const listedRaw = await this.cliRpc<unknown>("listMessages", {
          conversationId,
        }).catch(() => []);
        const listed: Array<{ _id: string; role: string; content?: string }> = Array.isArray(listedRaw)
          ? (listedRaw as any)
          : [];
        const userIndex = listed.findIndex((m) => m._id === userMessageId);
        const assistant = listed.slice(userIndex + 1).filter((m) => m.role === "assistant").at(-1);
        if (assistant?.content?.trim()) {
          return { text: assistant.content };
        }
        throw new Error(`Model response timeout after ${timeoutMs}ms`);
      }

      if (cancelled) {
        throw new Error("Run cancelled by user");
      }

      if (doneSignal || String(err).includes("done") || String(err).includes("AbortError")) {
        const listedRaw = await this.cliRpc<unknown>("listMessages", {
          conversationId,
        });
        const listed: Array<{ _id: string; role: string; content?: string }> = Array.isArray(listedRaw)
          ? (listedRaw as any)
          : [];
        const userIndex = listed.findIndex((m) => m._id === userMessageId);
        const assistant = listed.slice(userIndex + 1).filter((m) => m.role === "assistant").at(-1);
        if (assistant?.content?.trim()) return { text: assistant.content };
      }
      logger.error({
        conversationId,
        userMessageId,
        error: err instanceof Error ? err.message : String(err),
      }, "model wait failed");
      throw err;
    } finally {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
    }
  }
}

export function loadBlahCliApiKey(): string | null {
  const authStore = new Conf<{ credentials?: StoredCredentials }>({
    projectName: "blah-chat",
    projectVersion: "1.0.0",
    configName: "auth",
  });
  const legacyStore = new Conf<{ credentials?: StoredCredentials }>({
    projectName: "blah-chat",
    projectVersion: "1.0.0",
    configName: "config",
  });

  return (
    authStore.get("credentials")?.apiKey ?? legacyStore.get("credentials")?.apiKey ?? null
  );
}

export function loadBlahCliAppUrl(): string | null {
  const configStore = new Conf<{ appUrl?: string }>({
    projectName: "blah-chat",
    projectVersion: "1.0.0",
    configName: "config",
  });
  return configStore.get("appUrl") ?? null;
}

function getBlahCodeAuthStore() {
  return new Conf<{ credentials?: StoredCredentials }>({
    projectName: "blah-code",
    projectVersion: "1.0.0",
    configName: "auth",
  });
}

function getBlahCodeConfigStore() {
  return new Conf<{ appUrl?: string }>({
    projectName: "blah-code",
    projectVersion: "1.0.0",
    configName: "config",
  });
}

export function loadBlahCodeCredentials(): StoredCredentials | null {
  return getBlahCodeAuthStore().get("credentials") ?? null;
}

export function saveBlahCodeCredentials(credentials: StoredCredentials): void {
  getBlahCodeAuthStore().set("credentials", credentials);
}

export function clearBlahCodeCredentials(): void {
  getBlahCodeAuthStore().delete("credentials");
}

export function loadBlahCodeApiKey(): string | null {
  return loadBlahCodeCredentials()?.apiKey ?? null;
}

export function loadBlahCodeAppUrl(): string | null {
  return getBlahCodeConfigStore().get("appUrl") ?? null;
}

export function saveBlahCodeAppUrl(appUrl: string): void {
  getBlahCodeConfigStore().set("appUrl", normalizeBaseUrl(appUrl));
}

export function getBlahCodeAuthPath(): string {
  return getBlahCodeAuthStore().path;
}

export async function validateBlahApiKey(input: {
  apiKey: string;
  baseUrl?: string;
}): Promise<{ email: string; name: string }> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const res = await fetch(`${baseUrl}/api/v1/cli/rpc`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": input.apiKey,
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({ method: "validateApiKey" }),
  });

  const json = (await res.json()) as CliRpcEnvelope<{
    email?: string;
    name?: string;
  }>;

  if (!res.ok || json.status === "error" || !json.data?.email) {
    const message =
      typeof json.error === "string" ? json.error : (json.error?.message ?? "API key validation failed");
    throw new Error(message);
  }

  return {
    email: json.data.email,
    name: json.data.name ?? json.data.email.split("@")[0] ?? "User",
  };
}

export async function startBlahCodeOAuthFlow(input?: {
  baseUrl?: string;
  timeoutMs?: number;
}): Promise<StoredCredentials> {
  const baseUrl = normalizeBaseUrl(input?.baseUrl);
  const timeoutMs = input?.timeoutMs ?? 5 * 60 * 1000;

  return await new Promise<StoredCredentials>((resolve, reject) => {
    const callbackPath = "/oauth/callback";
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "", "http://127.0.0.1");

      if (url.pathname === callbackPath && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(
          "<!doctype html><html><body><script>(function(){const p=new URLSearchParams(location.hash.slice(1));fetch('/oauth/callback/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({api_key:p.get('api_key'),key_prefix:p.get('key_prefix'),email:p.get('email'),name:p.get('name'),error:p.get('error')})}).then(()=>{document.body.innerHTML='Authentication complete. You can close this window.';setTimeout(()=>window.close(),2000);}).catch(()=>{document.body.innerHTML='Authentication failed. Return to terminal.';});})();</script></body></html>",
        );
        return;
      }

      if (url.pathname === `${callbackPath}/complete` && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const data = JSON.parse(body) as {
              api_key?: string;
              key_prefix?: string;
              email?: string;
              name?: string;
              error?: string;
            };

            if (data.error) {
              res.writeHead(400).end(data.error);
              server.close();
              reject(new Error(data.error));
              return;
            }

            if (!data.api_key || !data.email) {
              res.writeHead(400).end("missing callback fields");
              server.close();
              reject(new Error("Missing required callback fields"));
              return;
            }

            const credentials: StoredCredentials = {
              apiKey: data.api_key,
              keyPrefix: data.key_prefix ?? `${data.api_key.slice(0, 12)}...`,
              email: data.email,
              name: data.name ?? data.email.split("@")[0] ?? "User",
              createdAt: Date.now(),
            };

            res.writeHead(200).end("ok");
            server.close();
            resolve(credentials);
          } catch {
            res.writeHead(400).end("invalid callback payload");
            server.close();
            reject(new Error("Invalid callback payload"));
          }
        });
        return;
      }

      res.writeHead(404).end("not found");
    });

    server.on("error", (error) => {
      reject(new Error(`Failed to start callback server: ${error.message}`));
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo | null;
      const port = address?.port;
      if (!port) {
        server.close();
        reject(new Error("Could not determine callback port"));
        return;
      }

      const callbackUrl = `http://127.0.0.1:${port}${callbackPath}`;
      const loginUrl = `${baseUrl}/cli-login?callback=${encodeURIComponent(callbackUrl)}`;
      open(loginUrl).catch((error: unknown) => {
        server.close();
        const message = error instanceof Error ? error.message : String(error);
        reject(new Error(`Failed to open browser: ${message}`));
      });
    });

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Authentication timed out after 5 minutes"));
    }, timeoutMs);

    server.on("close", () => clearTimeout(timeout));
  });
}

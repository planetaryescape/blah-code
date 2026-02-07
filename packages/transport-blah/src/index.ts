import { createParser, type EventSourceMessage } from "eventsource-parser";
import Conf from "conf";

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
  }): Promise<{ text: string }>;
}

export interface BlahTransportOptions {
  apiKey: string;
  baseUrl?: string;
  conversationId?: string;
}

interface StoredCredentials {
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

export class BlahTransport implements ModelTransport {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private conversationId: string | null;

  constructor(options: BlahTransportOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://blah.chat").replace(/\/$/, "");
    this.conversationId = options.conversationId ?? null;
  }

  getConversationId(): string | null {
    return this.conversationId;
  }

  private async cliRpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/v1/cli/rpc`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ method, params }),
    });

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
  }): Promise<{ text: string }> {
    const conversationId = await this.ensureConversation(input.modelId);
    const prompt = this.renderPrompt(input.messages, input.tools);

    const sent = await this.cliRpc<{ userMessageId: string }>("sendMessage", {
      conversationId,
      content: prompt,
      modelId: input.modelId,
    });

    return await this.waitForAssistant(conversationId, sent.userMessageId, input.timeoutMs ?? 120000);
  }

  private async waitForAssistant(
    conversationId: string,
    userMessageId: string,
    timeoutMs: number,
  ): Promise<{ text: string }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort("timeout"), timeoutMs);

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
      const parser = createParser({
        onEvent: (event: EventSourceMessage) => {
          if (!event.data) return;
          try {
            const payload = JSON.parse(event.data) as { messages?: Array<{ _id: string; role: string; status?: string; content?: string; partialContent?: string }> };
            const messages = payload.messages ?? [];
            const userIndex = messages.findIndex((m) => m._id === userMessageId);
            if (userIndex < 0) return;
            const assistants = messages.slice(userIndex + 1).filter((m) => m.role === "assistant");
            const last = assistants.at(-1);
            if (!last) return;
            latestText = last.content || last.partialContent || latestText;
            if (last.status === "complete" && latestText.trim()) {
              ctrl.abort("done");
            }
            if (last.status === "error") {
              throw new Error(last.content || "Assistant generation failed");
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
      }

      if (!latestText.trim()) {
        throw new Error("No assistant response received");
      }
      return { text: latestText };
    } catch (err) {
      if (String(err).includes("done") || String(err).includes("AbortError")) {
        const listed = await this.cliRpc<Array<{ _id: string; role: string; content?: string }>>("listMessages", {
          conversationId,
        });
        const userIndex = listed.findIndex((m) => m._id === userMessageId);
        const assistant = listed.slice(userIndex + 1).filter((m) => m.role === "assistant").at(-1);
        if (assistant?.content?.trim()) return { text: assistant.content };
      }
      throw err;
    } finally {
      clearTimeout(timer);
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

import { loadBlahCodeConfig } from "@blah-code/config";
import { AgentRunner, type PermissionRequest, type PermissionResolution } from "@blah-code/core";
import { createLogger, logPath, readLogTail } from "@blah-code/logger";
import { SessionStore, type SessionSummary } from "@blah-code/session";
import { createToolRuntime } from "@blah-code/tools";
import {
  BlahTransport,
  loadBlahCliApiKey,
  loadBlahCliAppUrl,
  loadBlahCodeApiKey,
  loadBlahCodeAppUrl,
} from "@blah-code/transport-blah";
import { createParser, type EventSourceMessage } from "eventsource-parser";
import type { TuiEvent } from "./state";

const logger = createLogger("cli.tui.runtime");

export interface RuntimeStatus {
  mode: "in_process" | "daemon";
  cwd: string;
  modelId: string;
  daemonHealthy: boolean;
  apiKeyPresent: boolean;
  activeSessions: string[];
  dbPath: string;
  logPath: string;
}

interface PromptInput {
  sessionId: string;
  prompt: string;
  modelId?: string;
  timeoutMs?: number;
  onEvent?: (event: TuiEvent) => void;
  onPermissionRequest?: (request: PermissionRequest) => Promise<PermissionResolution>;
}

export interface RuntimeClient {
  createSession(): Promise<string>;
  listSessions(limit?: number): Promise<SessionSummary[]>;
  listEvents(sessionId: string): Promise<TuiEvent[]>;
  runPrompt(input: PromptInput): Promise<{ output: string }>;
  getStatus(): Promise<RuntimeStatus>;
  getLogs(lines?: number): Promise<string[]>;
  close(): Promise<void>;
}

interface RuntimeOptions {
  cwd: string;
  attachUrl?: string;
  modelId?: string;
  timeoutMs?: number;
}

function normalizeBaseUrl(input?: string): string {
  return (input ?? "http://127.0.0.1:3789").replace(/\/$/, "");
}

function resolveModelId(configModel?: string, modelId?: string): string {
  return modelId ?? process.env.BLAH_MODEL_ID ?? configModel ?? "openai:gpt-5-mini";
}

function resolveApiKey(): string | null {
  return process.env.BLAH_API_KEY ?? loadBlahCodeApiKey() ?? loadBlahCliApiKey();
}

async function checkDaemonHealth(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1000);
  try {
    const res = await fetch(`${url}/health`, {
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

class LocalRuntime implements RuntimeClient {
  private store = new SessionStore();
  private config;
  private cwd: string;
  private modelId: string;
  private timeoutMs: number;
  private baseUrl: string;
  private daemonUrl: string;
  private activeSessions = new Set<string>();

  constructor(options: RuntimeOptions) {
    this.cwd = options.cwd;
    this.config = loadBlahCodeConfig(this.cwd);
    this.modelId = resolveModelId(this.config.model, options.modelId);
    this.timeoutMs = options.timeoutMs ?? this.config.timeout?.modelMs ?? 120000;
    this.baseUrl =
      process.env.BLAH_BASE_URL ?? loadBlahCodeAppUrl() ?? loadBlahCliAppUrl() ?? "https://blah.chat";
    const daemonHost = this.config.daemon?.host ?? "127.0.0.1";
    const daemonPort = this.config.daemon?.port ?? 3789;
    this.daemonUrl = `http://${daemonHost}:${daemonPort}`;
  }

  async createSession(): Promise<string> {
    return this.store.createSession();
  }

  async listSessions(limit = 20): Promise<SessionSummary[]> {
    return this.store.listSessions(limit);
  }

  async listEvents(sessionId: string): Promise<TuiEvent[]> {
    return this.store.listEvents(sessionId);
  }

  async runPrompt(input: PromptInput): Promise<{ output: string }> {
    const apiKey = resolveApiKey();
    if (!apiKey) {
      throw new Error("BLAH_API_KEY required. Run `blah-code login`.");
    }

    const transport = new BlahTransport({
      apiKey,
      baseUrl: this.baseUrl,
    });
    const runner = new AgentRunner(transport);
    const toolRuntime = await createToolRuntime({ mcpServers: this.config.mcp });
    this.activeSessions.add(input.sessionId);

    try {
      const result = await runner.run({
        prompt: input.prompt,
        modelId: input.modelId ?? this.modelId,
        timeoutMs: input.timeoutMs ?? this.timeoutMs,
        cwd: this.cwd,
        policy: this.config.permission,
        toolRuntime,
        onEvent: (event) => {
          const saved = this.store.appendEvent(input.sessionId, event.type, event.payload);
          input.onEvent?.(saved);
        },
        onPermissionRequest: (request) => {
          if (!input.onPermissionRequest) return Promise.resolve({ decision: "deny" });
          return input.onPermissionRequest(request);
        },
      });

      return { output: result.text };
    } finally {
      this.activeSessions.delete(input.sessionId);
      await toolRuntime.close();
    }
  }

  async getStatus(): Promise<RuntimeStatus> {
    return {
      mode: "in_process",
      cwd: this.cwd,
      modelId: this.modelId,
      daemonHealthy: await checkDaemonHealth(this.daemonUrl),
      apiKeyPresent: Boolean(resolveApiKey()),
      activeSessions: Array.from(this.activeSessions),
      dbPath: this.store.dbPath(),
      logPath: logPath(),
    };
  }

  async getLogs(lines = 200): Promise<string[]> {
    return readLogTail(lines);
  }

  async close(): Promise<void> {
    return;
  }
}

class RemoteRuntime implements RuntimeClient {
  private baseUrl: string;

  constructor(options: RuntimeOptions) {
    this.baseUrl = normalizeBaseUrl(options.attachUrl);
  }

  private async request<T>(pathname: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${pathname}`, init);
    const body = await res.text();
    const json = body ? (JSON.parse(body) as T & { error?: string }) : ({} as T & { error?: string });

    if (!res.ok) {
      const message = "error" in json && typeof json.error === "string" ? json.error : `${res.status}`;
      throw new Error(message);
    }
    return json as T;
  }

  async createSession(): Promise<string> {
    const json = await this.request<{ sessionId: string }>("/v1/sessions", { method: "POST" });
    return json.sessionId;
  }

  async listSessions(limit = 20): Promise<SessionSummary[]> {
    const json = await this.request<{ sessions: SessionSummary[] }>(`/v1/sessions?limit=${limit}`);
    return json.sessions ?? [];
  }

  async listEvents(sessionId: string): Promise<TuiEvent[]> {
    return this.request<TuiEvent[]>(`/v1/sessions/${sessionId}/events`);
  }

  private async streamEvents(
    sessionId: string,
    onEvent: (event: TuiEvent) => void,
    onPermissionRequest?: (request: PermissionRequest) => Promise<PermissionResolution>,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}/events/stream`, { signal });
    if (!response.ok || !response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const parser = createParser({
      onEvent: (raw: EventSourceMessage) => {
        if (!raw.data) return;
        const payload = JSON.parse(raw.data) as { events?: TuiEvent[]; event?: TuiEvent };

        if (raw.event === "snapshot") {
          for (const entry of payload.events ?? []) onEvent(entry);
          return;
        }

        if (raw.event === "update" && payload.event) {
          onEvent(payload.event);
          if (payload.event.kind === "permission_request" && onPermissionRequest) {
            const request = payload.event.payload as PermissionRequest;
            onPermissionRequest(request)
              .then((resolution) =>
                this.request(`/v1/sessions/${sessionId}/permissions/${request.requestId}/reply`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    decision: resolution.decision,
                    remember: resolution.remember
                      ? {
                          key: resolution.remember.key,
                          pattern: resolution.remember.pattern,
                        }
                      : undefined,
                  }),
                }),
              )
              .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`remote permission resolution failed error=${message}`);
              });
          }
        }
      },
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
      if (signal?.aborted) break;
    }
  }

  async runPrompt(input: PromptInput): Promise<{ output: string }> {
    const ctrl = new AbortController();
    const streamPromise = input.onEvent
      ? this.streamEvents(input.sessionId, input.onEvent, input.onPermissionRequest, ctrl.signal).catch(() => undefined)
      : Promise.resolve();

    try {
      const json = await this.request<{ output: string }>(`/v1/sessions/${input.sessionId}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: input.prompt,
          modelId: input.modelId,
          timeoutMs: input.timeoutMs,
        }),
      });
      return { output: json.output };
    } finally {
      ctrl.abort();
      await streamPromise;
    }
  }

  async getStatus(): Promise<RuntimeStatus> {
    const json = await this.request<{
      mode?: "daemon";
      cwd: string;
      modelId: string;
      apiKeyPresent: boolean;
      activeSessions: string[];
      dbPath: string;
      logPath: string;
    }>("/v1/status");

    return {
      mode: "daemon",
      cwd: json.cwd,
      modelId: json.modelId,
      daemonHealthy: true,
      apiKeyPresent: json.apiKeyPresent,
      activeSessions: json.activeSessions,
      dbPath: json.dbPath,
      logPath: json.logPath,
    };
  }

  async getLogs(lines = 200): Promise<string[]> {
    const json = await this.request<{ lines: string[] }>(`/v1/logs?lines=${lines}`);
    return json.lines ?? [];
  }

  async close(): Promise<void> {
    return;
  }
}

export function createRuntimeClient(options: RuntimeOptions): RuntimeClient {
  if (options.attachUrl) return new RemoteRuntime(options);
  return new LocalRuntime(options);
}

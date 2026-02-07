import { createParser, type EventSourceMessage } from "eventsource-parser";

export interface SessionEvent {
  id: string;
  sessionId: string;
  kind: string;
  payload: unknown;
  createdAt: number;
}

export interface PermissionRequest {
  requestId: string;
  op: "read" | "write" | "exec" | "network";
  tool: string;
  target: string;
  args: unknown;
  createdAt?: number;
}

export interface BlahCodeClient {
  createSession(): Promise<{ sessionId: string }>;
  runPrompt(sessionId: string, prompt: string): Promise<{ output: string; policy?: unknown }>;
  listEvents(sessionId: string): Promise<SessionEvent[]>;
  streamEvents(sessionId: string, signal?: AbortSignal): AsyncGenerator<SessionEvent>;
  listTools(): Promise<{ tools: Array<{ name: string; description: string; schema: unknown; permission: string }> }>;
  getPermissionRules(): Promise<{ policy: unknown }>;
  setPermissionRules(policy: unknown): Promise<{ success: boolean; policy: unknown }>;
  listPermissions(sessionId: string): Promise<PermissionRequest[]>;
  replyPermission(input: {
    sessionId: string;
    requestId: string;
    decision: "allow" | "deny" | "ask";
    remember?: { key: string; pattern: string };
  }): Promise<{ success: boolean }>;
  checkpointSession(input: {
    sessionId: string;
    name?: string;
    summary?: string;
  }): Promise<{ checkpointId: string }>;
  revertSession(input: {
    sessionId: string;
    checkpointId: string;
  }): Promise<{ success: boolean }>;
}

export function createBlahCodeClient(baseUrl = "http://127.0.0.1:3789"): BlahCodeClient {
  const root = baseUrl.replace(/\/$/, "");

  return {
    async createSession() {
      const res = await fetch(`${root}/v1/sessions`, { method: "POST" });
      if (!res.ok) throw new Error(`createSession failed: ${res.status}`);
      return await res.json();
    },

    async runPrompt(sessionId: string, prompt: string) {
      const res = await fetch(`${root}/v1/sessions/${sessionId}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error(`runPrompt failed: ${res.status}`);
      return await res.json();
    },

    async listEvents(sessionId: string) {
      const res = await fetch(`${root}/v1/sessions/${sessionId}/events`);
      if (!res.ok) throw new Error(`listEvents failed: ${res.status}`);
      return await res.json();
    },

    async listTools() {
      const res = await fetch(`${root}/v1/tools`);
      if (!res.ok) throw new Error(`listTools failed: ${res.status}`);
      return await res.json();
    },

    async getPermissionRules() {
      const res = await fetch(`${root}/v1/permissions/rules`);
      if (!res.ok) throw new Error(`getPermissionRules failed: ${res.status}`);
      return await res.json();
    },

    async setPermissionRules(policy: unknown) {
      const res = await fetch(`${root}/v1/permissions/rules`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policy }),
      });
      if (!res.ok) throw new Error(`setPermissionRules failed: ${res.status}`);
      return await res.json();
    },

    async *streamEvents(sessionId: string, signal?: AbortSignal) {
      const response = await fetch(`${root}/v1/sessions/${sessionId}/events/stream`, {
        method: "GET",
        headers: { accept: "text/event-stream" },
        signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`streamEvents failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const queue: SessionEvent[] = [];

      const parser = createParser({
        onEvent(event: EventSourceMessage) {
          if (!event.data) return;
          try {
            const data = JSON.parse(event.data) as { events?: SessionEvent[]; event?: SessionEvent };
            if (event.event === "snapshot") {
              for (const e of data.events ?? []) queue.push(e);
            }
            if (event.event === "update" && data.event) {
              queue.push(data.event);
            }
          } catch {
            // ignore malformed chunks
          }
        },
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        parser.feed(decoder.decode(value, { stream: true }));
        while (queue.length > 0) {
          const next = queue.shift();
          if (next) yield next;
        }
      }
    },

    async listPermissions(sessionId: string) {
      const res = await fetch(`${root}/v1/sessions/${sessionId}/permissions`);
      if (!res.ok) throw new Error(`listPermissions failed: ${res.status}`);
      return await res.json();
    },

    async replyPermission(input) {
      const res = await fetch(
        `${root}/v1/sessions/${input.sessionId}/permissions/${input.requestId}/reply`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            decision: input.decision,
            remember: input.remember,
          }),
        },
      );
      if (!res.ok) throw new Error(`replyPermission failed: ${res.status}`);
      return await res.json();
    },

    async checkpointSession(input) {
      const res = await fetch(`${root}/v1/sessions/${input.sessionId}/checkpoint`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: input.name, summary: input.summary }),
      });
      if (!res.ok) throw new Error(`checkpointSession failed: ${res.status}`);
      return await res.json();
    },

    async revertSession(input) {
      const res = await fetch(`${root}/v1/sessions/${input.sessionId}/revert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkpointId: input.checkpointId }),
      });
      if (!res.ok) throw new Error(`revertSession failed: ${res.status}`);
      return await res.json();
    },
  };
}

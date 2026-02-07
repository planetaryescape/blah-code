import { loadBlahCodeConfig } from "@blah-code/config";
import {
  AgentRunner,
  type PermissionRequest,
  type PermissionResolution,
} from "@blah-code/core";
import { SessionStore } from "@blah-code/session";
import { createToolRuntime } from "@blah-code/tools";
import {
  BlahTransport,
  loadBlahCliApiKey,
  loadBlahCliAppUrl,
} from "@blah-code/transport-blah";
import Fastify from "fastify";

interface SessionEvent {
  id: string;
  sessionId: string;
  kind: string;
  payload: unknown;
  createdAt: number;
}

interface PendingApproval {
  request: PermissionRequest;
  resolve: (value: PermissionResolution) => void;
  reject: (error: Error) => void;
  createdAt: number;
}

const app = Fastify({ logger: true });
const store = new SessionStore();
const pendingApprovals = new Map<string, Map<string, PendingApproval>>();
const listeners = new Map<string, Set<(event: SessionEvent) => void>>();

const config = loadBlahCodeConfig(process.cwd());

const runtime = {
  baseUrl: process.env.BLAH_BASE_URL ?? loadBlahCliAppUrl() ?? "https://blah.chat",
  apiKey: process.env.BLAH_API_KEY ?? loadBlahCliApiKey(),
  modelId: process.env.BLAH_MODEL_ID ?? config.model ?? "openai:gpt-5-mini",
  cwd: process.cwd(),
  permissionPolicy: config.permission ?? {},
};

const toolRuntimePromise = createToolRuntime({
  mcpServers: config.mcp,
});

function emitEvent(sessionId: string, kind: string, payload: unknown): SessionEvent {
  const event = store.appendEvent(sessionId, kind, payload);
  const eventObj: SessionEvent = {
    id: event.id,
    sessionId: event.sessionId,
    kind: event.kind,
    payload: event.payload,
    createdAt: event.createdAt,
  };

  const sessionListeners = listeners.get(sessionId);
  if (sessionListeners) {
    for (const notify of sessionListeners) {
      notify(eventObj);
    }
  }

  return eventObj;
}

app.get("/health", async () => ({ status: "ok" }));

app.get("/v1/tools", async () => {
  const toolRuntime = await toolRuntimePromise;
  return {
    tools: toolRuntime.listToolSpecs(),
  };
});

app.get("/v1/permissions/rules", async () => {
  return {
    policy: runtime.permissionPolicy,
  };
});

app.post<{ Body: { policy: unknown } }>("/v1/permissions/rules", async (req, reply) => {
  if (!req.body || typeof req.body.policy !== "object") {
    return reply.status(400).send({ error: "policy object required" });
  }
  runtime.permissionPolicy = req.body.policy as Record<string, unknown>;
  return { success: true, policy: runtime.permissionPolicy };
});

app.post("/v1/sessions", async () => {
  const sessionId = store.createSession();
  return { sessionId };
});

app.post<{ Params: { id: string }; Body: { name?: string; summary?: string } }>(
  "/v1/sessions/:id/checkpoint",
  async (req, reply) => {
    const checkpointId = crypto.randomUUID();
    emitEvent(req.params.id, "checkpoint", {
      checkpointId,
      name: req.body?.name ?? "checkpoint",
      summary: req.body?.summary ?? "",
      createdAt: Date.now(),
    });
    return reply.send({ checkpointId });
  },
);

app.post<{ Params: { id: string }; Body: { checkpointId: string } }>(
  "/v1/sessions/:id/revert",
  async (req, reply) => {
    emitEvent(req.params.id, "revert", {
      checkpointId: req.body.checkpointId,
      revertedAt: Date.now(),
    });
    return reply.send({ success: true });
  },
);

app.get<{ Params: { id: string } }>("/v1/sessions/:id/events", async (req, reply) => {
  return reply.send(store.listEvents(req.params.id));
});

app.get<{ Params: { id: string } }>(
  "/v1/sessions/:id/events/stream",
  async (req, reply) => {
    const sessionId = req.params.id;
    reply.raw.setHeader("content-type", "text/event-stream");
    reply.raw.setHeader("cache-control", "no-cache");
    reply.raw.setHeader("connection", "keep-alive");

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send("snapshot", { events: store.listEvents(sessionId) });

    const heartbeat = setInterval(() => send("heartbeat", { ts: Date.now() }), 30000);

    if (!listeners.has(sessionId)) {
      listeners.set(sessionId, new Set());
    }

    const notify = (event: SessionEvent) => send("update", { event });
    listeners.get(sessionId)?.add(notify);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      listeners.get(sessionId)?.delete(notify);
    });

    return reply;
  },
);

app.get<{ Params: { id: string } }>("/v1/sessions/:id/permissions", async (req, reply) => {
  const sessionMap = pendingApprovals.get(req.params.id);
  if (!sessionMap) return reply.send([]);

  const requests = Array.from(sessionMap.values()).map((p) => ({
    ...p.request,
    createdAt: p.createdAt,
  }));

  return reply.send(requests);
});

app.post<{
  Params: { id: string; requestId: string };
  Body: { decision: "allow" | "deny" | "ask"; remember?: { key: string; pattern: string } };
}>("/v1/sessions/:id/permissions/:requestId/reply", async (req, reply) => {
  const sessionMap = pendingApprovals.get(req.params.id);
  const pending = sessionMap?.get(req.params.requestId);

  if (!pending) {
    return reply.status(404).send({ error: "Permission request not found" });
  }

  const resolution: PermissionResolution = {
    decision: req.body.decision,
    remember: req.body.remember
      ? {
          key: req.body.remember.key,
          pattern: req.body.remember.pattern,
          decision: req.body.decision,
        }
      : undefined,
  };

  pending.resolve(resolution);
  sessionMap?.delete(req.params.requestId);

  emitEvent(req.params.id, "permission_resolved", {
    requestId: req.params.requestId,
    decision: req.body.decision,
    remember: req.body.remember ?? null,
  });

  return reply.send({ success: true });
});

app.post<{ Params: { id: string }; Body: { prompt: string; modelId?: string } }>(
  "/v1/sessions/:id/prompt",
  async (req, reply) => {
    if (!runtime.apiKey) {
      return reply.status(400).send({ error: "BLAH_API_KEY missing" });
    }

    const transport = new BlahTransport({
      apiKey: runtime.apiKey,
      baseUrl: runtime.baseUrl,
    });

    const runner = new AgentRunner(transport);
    const toolRuntime = await toolRuntimePromise;

    const result = await runner.run({
      prompt: req.body.prompt,
      cwd: runtime.cwd,
      modelId: req.body.modelId ?? runtime.modelId,
      policy: runtime.permissionPolicy,
      toolRuntime,
      onEvent(event) {
        emitEvent(req.params.id, event.type, event.payload);
      },
      onPermissionRequest(permissionRequest) {
        if (!pendingApprovals.has(req.params.id)) {
          pendingApprovals.set(req.params.id, new Map());
        }

        return new Promise<PermissionResolution>((resolve, reject) => {
          const sessionMap = pendingApprovals.get(req.params.id)!;

          sessionMap.set(permissionRequest.requestId, {
            request: permissionRequest,
            resolve,
            reject,
            createdAt: Date.now(),
          });

          emitEvent(req.params.id, "permission_request", permissionRequest);

          setTimeout(() => {
            const stillPending = sessionMap.get(permissionRequest.requestId);
            if (!stillPending) return;
            sessionMap.delete(permissionRequest.requestId);
            resolve({ decision: "deny" });
          }, 5 * 60 * 1000);
        });
      },
    });

    return reply.send({ output: result.text, policy: result.policy });
  },
);

const port = Number(process.env.BLAH_CODE_PORT ?? 3789);
app.listen({ host: "127.0.0.1", port }).catch(async (error) => {
  app.log.error(error);
  const toolRuntime = await toolRuntimePromise.catch(() => null);
  await toolRuntime?.close().catch(() => undefined);
  process.exit(1);
});

const shutdown = async () => {
  const toolRuntime = await toolRuntimePromise.catch(() => null);
  await toolRuntime?.close().catch(() => undefined);
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

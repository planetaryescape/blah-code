#!/usr/bin/env bun
import { createBlahCodeServer } from "@blah-code/daemon";
import { loadBlahCodeConfig } from "@blah-code/config";
import {
  AgentRunner,
  type PermissionRequest,
  type PermissionResolution,
} from "@blah-code/core";
import { createLogger, initLogging, logPath, readLogTail, type LogLevel } from "@blah-code/logger";
import { SessionStore } from "@blah-code/session";
import { createToolRuntime } from "@blah-code/tools";
import {
  BlahTransport,
  loadBlahCodeApiKey,
  loadBlahCodeAppUrl,
  loadBlahCodeCredentials,
  saveBlahCodeAppUrl,
  saveBlahCodeCredentials,
  loadBlahCliApiKey,
  loadBlahCliAppUrl,
  startBlahCodeOAuthFlow,
  validateBlahApiKey,
} from "@blah-code/transport-blah";
import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runTui } from "./tui/app";

type LogOpts = {
  printLogs?: boolean;
  logLevel?: LogLevel;
};

const program = new Command();

program
  .name("blah-code")
  .description("Local-first coding agent for blah.chat")
  .version("0.1.0")
  .option("--attach <url>", "attach TUI to daemon URL")
  .option("--cwd <dir>", "workspace cwd", process.cwd())
  .option("--model <model>", "model id")
  .option("--timeout-ms <n>", "model timeout (ms)");

function applyLogging(cwd: string, opts?: LogOpts): void {
  const config = loadBlahCodeConfig(cwd);
  initLogging({
    level: opts?.logLevel ?? config.logging?.level,
    print: opts?.printLogs ?? config.logging?.print ?? false,
  });
}

async function promptPermission(
  request: PermissionRequest,
): Promise<PermissionResolution> {
  const rl = createInterface({ input, output });
  try {
    console.log(`\npermission required`);
    console.log(`op: ${request.op}`);
    console.log(`tool: ${request.tool}`);
    console.log(`target: ${request.target}`);

    const answer = (
      await rl.question("allow once(o), allow always(a), deny(d) [o/a/d]: ")
    )
      .trim()
      .toLowerCase();

    if (answer === "a") {
      return {
        decision: "allow",
        remember: {
          key: request.op,
          pattern: request.target || "*",
          decision: "allow",
        },
      };
    }

    if (answer === "d") {
      return { decision: "deny" };
    }

    return { decision: "allow" };
  } finally {
    rl.close();
  }
}

function resolveBaseUrl(input?: string): string {
  return (
    input ??
    process.env.BLAH_BASE_URL ??
    loadBlahCodeAppUrl() ??
    loadBlahCliAppUrl() ??
    "https://blah.chat"
  );
}

function parseLogLevel(level?: string): LogLevel | undefined {
  if (!level) return undefined;
  if (level === "debug" || level === "info" || level === "warn" || level === "error") {
    return level;
  }
  return undefined;
}

function resolveDaemonAddress(cwd: string, host?: string, port?: string | number): { host: string; port: number; url: string } {
  const config = loadBlahCodeConfig(cwd);
  const resolvedHost = host ?? config.daemon?.host ?? "127.0.0.1";
  const resolvedPort = Number(port ?? config.daemon?.port ?? process.env.BLAH_CODE_PORT ?? 3789);
  return {
    host: resolvedHost,
    port: resolvedPort,
    url: `http://${resolvedHost}:${resolvedPort}`,
  };
}

program
  .command("login")
  .description("Authenticate blah-code with blah.chat")
  .option("-k, --api-key <key>", "login with API key")
  .option("--base-url <url>", "blah base url")
  .option("--force", "overwrite existing blah-code login", false)
  .action(async (opts) => {
    const existing = loadBlahCodeCredentials();
    if (existing && !opts.force) {
      console.log(`Already logged in as ${existing.name ?? existing.email ?? "user"}`);
      console.log("Use --force to replace stored credentials.");
      return;
    }

    const baseUrl = resolveBaseUrl(opts.baseUrl);

    try {
      if (opts.apiKey) {
        if (!opts.apiKey.startsWith("blah_")) {
          console.error("Invalid API key format. Expected prefix: blah_");
          process.exit(1);
        }

        const profile = await validateBlahApiKey({
          apiKey: opts.apiKey,
          baseUrl,
        });

        saveBlahCodeCredentials({
          apiKey: opts.apiKey,
          keyPrefix: `${opts.apiKey.slice(0, 12)}...`,
          email: profile.email,
          name: profile.name,
          createdAt: Date.now(),
        });
        saveBlahCodeAppUrl(baseUrl);
        console.log(`Logged in as ${profile.name}`);
        return;
      }

      console.log("Opening browser for authentication...");
      console.log("Complete login in browser. Times out in 5 minutes.");
      const credentials = await startBlahCodeOAuthFlow({ baseUrl });
      saveBlahCodeCredentials(credentials);
      saveBlahCodeAppUrl(baseUrl);
      console.log(`Logged in as ${credentials.name ?? credentials.email ?? "user"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown login error";
      console.error(`Login failed: ${message}`);
      process.exit(1);
    }
  });

program
  .command("serve")
  .description("Run blah-code daemon API server")
  .option("--host <host>", "host")
  .option("--port <port>", "port")
  .option("--cwd <dir>", "workspace cwd", process.cwd())
  .option("--print-logs", "print logs to stderr", false)
  .option("--log-level <level>", "debug|info|warn|error")
  .action(async (opts) => {
    const cwd = opts.cwd ?? process.cwd();
    applyLogging(cwd, {
      printLogs: opts.printLogs,
      logLevel: parseLogLevel(opts.logLevel),
    });

    const server = createBlahCodeServer({
      cwd,
      host: opts.host,
      port: opts.port ? Number(opts.port) : undefined,
      printLogs: opts.printLogs,
      logLevel: parseLogLevel(opts.logLevel),
    });

    await server.start();
    console.log(`daemon: http://${server.host}:${server.port}`);
    console.log(`logs: ${logPath()}`);

    await new Promise<void>((resolve) => {
      const shutdown = async () => {
        await server.stop();
        resolve();
      };

      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    });
  });

program
  .command("status")
  .description("Show daemon/runtime status")
  .option("--attach <url>", "daemon URL")
  .option("--host <host>", "daemon host")
  .option("--port <port>", "daemon port")
  .option("--cwd <dir>", "workspace cwd", process.cwd())
  .option("--json", "json output", false)
  .action(async (opts) => {
    const cwd = opts.cwd ?? process.cwd();
    applyLogging(cwd);

    const daemon = opts.attach
      ? { url: opts.attach }
      : resolveDaemonAddress(cwd, opts.host, opts.port);

    const localApiKey =
      process.env.BLAH_API_KEY ?? loadBlahCodeApiKey() ?? loadBlahCliApiKey();
    const store = new SessionStore();

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch(`${daemon.url}/v1/status`, { signal: ctrl.signal });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`status request failed: ${res.status}`);
      }

      const json = await res.json();
      if (opts.json) {
        console.log(JSON.stringify(json, null, 2));
        return;
      }

      console.log(`daemon: up (${daemon.url})`);
      console.log(`mode: ${json.mode}`);
      console.log(`cwd: ${json.cwd}`);
      console.log(`model: ${json.modelId}`);
      console.log(`apiKey: ${json.apiKeyPresent ? "present" : "missing"}`);
      console.log(`activeSessions: ${Array.isArray(json.activeSessions) ? json.activeSessions.length : 0}`);
      console.log(`db: ${json.dbPath}`);
      console.log(`logs: ${json.logPath}`);
    } catch {
      const fallback = {
        daemon: "down",
        daemonUrl: daemon.url,
        apiKeyPresent: Boolean(localApiKey),
        dbPath: store.dbPath(),
        logPath: logPath(),
      };

      if (opts.json) {
        console.log(JSON.stringify(fallback, null, 2));
        return;
      }

      console.log(`daemon: down (${daemon.url})`);
      console.log(`apiKey: ${fallback.apiKeyPresent ? "present" : "missing"}`);
      console.log(`db: ${fallback.dbPath}`);
      console.log(`logs: ${fallback.logPath}`);
    }
  });

program
  .command("logs")
  .description("Tail blah-code logs")
  .option("--lines <n>", "line count", "200")
  .option("--attach <url>", "daemon URL")
  .option("--json", "json output", false)
  .action(async (opts) => {
    const lines = Number(opts.lines ?? "200");

    if (opts.attach) {
      const response = await fetch(`${opts.attach.replace(/\/$/, "")}/v1/logs?lines=${lines}`);
      if (!response.ok) {
        console.error(`failed to fetch remote logs: ${response.status}`);
        process.exit(1);
      }
      const json = (await response.json()) as { path: string; lines: string[] };
      if (opts.json) {
        console.log(JSON.stringify(json, null, 2));
        return;
      }
      for (const line of json.lines) console.log(line);
      return;
    }

    const entries = await readLogTail(lines);
    if (opts.json) {
      console.log(JSON.stringify({ path: logPath(), lines: entries }, null, 2));
      return;
    }

    for (const line of entries) console.log(line);
  });

program
  .command("sessions")
  .description("List recent sessions")
  .option("--limit <n>", "max sessions", "20")
  .option("--json", "json output", false)
  .action((opts) => {
    const store = new SessionStore();
    const sessions = store.listSessions(Number(opts.limit ?? "20"));

    if (opts.json) {
      console.log(JSON.stringify(sessions, null, 2));
      return;
    }

    if (sessions.length === 0) {
      console.log("No sessions found.");
      return;
    }

    for (const session of sessions) {
      const ts = new Date(session.lastEventAt ?? session.createdAt).toISOString();
      console.log(`${session.id}  ${ts}  events=${session.eventCount}`);
    }
  });

program
  .command("run")
  .description("Run one coding-agent task")
  .argument("<prompt>")
  .option("--model <model>", "model id")
  .option("--base-url <url>", "blah base url")
  .option("--api-key <key>", "blah api key")
  .option("--cwd <dir>", "workspace cwd", process.cwd())
  .option("--max-steps <n>", "max agent steps", "8")
  .option("--timeout-ms <n>", "model timeout (ms)")
  .option("--non-interactive", "deny ask-mode permissions", false)
  .option("--print-logs", "print logs to stderr", false)
  .option("--log-level <level>", "debug|info|warn|error")
  .option("--json", "json output", false)
  .action(async (prompt: string, opts) => {
    const cwd = opts.cwd ?? process.cwd();
    const config = loadBlahCodeConfig(cwd);

    applyLogging(cwd, {
      printLogs: opts.printLogs,
      logLevel: parseLogLevel(opts.logLevel),
    });

    const logger = createLogger("cli.run");
    const store = new SessionStore();
    const sessionId = store.createSession();

    const apiKey =
      opts.apiKey ?? process.env.BLAH_API_KEY ?? loadBlahCodeApiKey() ?? loadBlahCliApiKey();
    if (!apiKey) {
      const message = "BLAH_API_KEY required (env, --api-key, or run `blah-code login` first)";
      store.appendEvent(sessionId, "run_failed", { message });
      console.error(message);
      console.error(`session: ${sessionId}`);
      console.error(`logs: ${logPath()}`);
      console.error(`inspect events: blah-code events ${sessionId}`);
      process.exitCode = 1;
      return;
    }

    const baseUrl = resolveBaseUrl(opts.baseUrl);
    const modelId =
      opts.model ?? process.env.BLAH_MODEL_ID ?? config.model ?? "openai:gpt-5-mini";

    const timeoutMs = Number(opts.timeoutMs ?? config.timeout?.modelMs ?? 120000);

    const transport = new BlahTransport({ apiKey, baseUrl });
    const runner = new AgentRunner(transport);
    const toolRuntime = await createToolRuntime({ mcpServers: config.mcp });

    try {
      const result = await runner.run({
        prompt,
        modelId,
        timeoutMs,
        cwd,
        maxSteps: Number(opts.maxSteps),
        policy: config.permission,
        toolRuntime,
        onEvent(event) {
          store.appendEvent(sessionId, event.type, event.payload);
        },
        onPermissionRequest(request) {
          if (opts.nonInteractive) return Promise.resolve({ decision: "deny" });
          return promptPermission(request);
        },
      });

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              sessionId,
              output: result.text,
              policy: result.policy,
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(result.text);
      console.log(`\nsession: ${sessionId}`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`run command failed sessionId=${sessionId} error=${message}`);
      store.appendEvent(sessionId, "run_failed", { message });

      if (opts.json) {
        console.error(
          JSON.stringify(
            {
              sessionId,
              error: message,
            },
            null,
            2,
          ),
        );
      } else {
        console.error(`run failed: ${message}`);
        console.error(`session: ${sessionId}`);
        console.error(`logs: ${logPath()}`);
        console.error(`inspect events: blah-code events ${sessionId}`);
      }

      process.exitCode = 1;
    } finally {
      await toolRuntime.close();
    }
  });

program
  .command("events")
  .description("Print stored session events")
  .argument("<sessionId>")
  .option("--json", "json", false)
  .action((sessionId: string, opts) => {
    const store = new SessionStore();
    const events = store.listEvents(sessionId);

    if (opts.json) {
      console.log(JSON.stringify(events, null, 2));
      return;
    }

    for (const event of events) {
      console.log(`${new Date(event.createdAt).toISOString()} ${event.kind}`);
      console.log(JSON.stringify(event.payload));
      console.log();
    }
  });

program.action(async () => {
  const opts = program.opts<{
    attach?: string;
    cwd?: string;
    model?: string;
    timeoutMs?: string;
  }>();

  const cwd = opts.cwd ?? process.cwd();
  applyLogging(cwd);

  await runTui({
    cwd,
    attachUrl: opts.attach,
    modelId: opts.model,
    timeoutMs: opts.timeoutMs ? Number(opts.timeoutMs) : undefined,
  });
});

await program.parseAsync(process.argv);

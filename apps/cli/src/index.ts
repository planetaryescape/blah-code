#!/usr/bin/env bun
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
import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const program = new Command();

program
  .name("blah-code")
  .description("Local-first coding agent for blah.chat")
  .version("0.1.0");

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

program
  .command("run")
  .description("Run one coding-agent task")
  .argument("<prompt>")
  .option("--model <model>", "model id")
  .option("--base-url <url>", "blah base url")
  .option("--api-key <key>", "blah api key")
  .option("--cwd <dir>", "workspace cwd", process.cwd())
  .option("--max-steps <n>", "max agent steps", "8")
  .option("--non-interactive", "deny ask-mode permissions", false)
  .option("--json", "json output", false)
  .action(async (prompt: string, opts) => {
    const config = loadBlahCodeConfig(opts.cwd);

    const apiKey = opts.apiKey ?? process.env.BLAH_API_KEY ?? loadBlahCliApiKey();
    if (!apiKey) {
      console.error("BLAH_API_KEY required (env, --api-key, or run `blah login` first)");
      process.exit(1);
    }

    const baseUrl = opts.baseUrl ?? process.env.BLAH_BASE_URL ?? loadBlahCliAppUrl() ?? "https://blah.chat";
    const modelId =
      opts.model ?? process.env.BLAH_MODEL_ID ?? config.model ?? "openai:gpt-5-mini";

    const transport = new BlahTransport({ apiKey, baseUrl });
    const runner = new AgentRunner(transport);
    const store = new SessionStore();
    const sessionId = store.createSession();
    const toolRuntime = await createToolRuntime({ mcpServers: config.mcp });

    try {
      const result = await runner.run({
        prompt,
        modelId,
        cwd: opts.cwd,
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

await program.parseAsync(process.argv);

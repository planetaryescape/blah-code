import {
  appendPolicyRule,
  evaluatePermission,
  normalizePolicy,
  type PermissionDecision,
  type PermissionPolicy,
} from "@blah-code/policy";
import { createToolRuntime, type ToolRuntime } from "@blah-code/tools";
import { z } from "zod";

export type AgentRole = "system" | "user" | "assistant" | "tool";

export interface AgentMessage {
  role: AgentRole;
  content: string;
}

export interface ModelTransport {
  complete(input: {
    messages: AgentMessage[];
    modelId: string;
    tools: Array<{ name: string; description: string; schema: unknown }>;
    timeoutMs?: number;
  }): Promise<{ text: string }>;
}

export interface AgentEvent {
  type:
    | "assistant"
    | "tool_call"
    | "tool_result"
    | "permission_request"
    | "permission_resolved"
    | "error"
    | "done";
  payload: unknown;
}

export interface PermissionRequest {
  requestId: string;
  op: "read" | "write" | "exec" | "network";
  tool: string;
  target: string;
  args: unknown;
}

export interface PermissionResolution {
  decision: PermissionDecision;
  remember?: {
    key: string;
    pattern: string;
    decision: PermissionDecision;
  };
}

export interface AgentRunOptions {
  prompt: string;
  modelId: string;
  cwd: string;
  maxSteps?: number;
  policy?: unknown;
  toolRuntime?: ToolRuntime;
  onEvent?: (event: AgentEvent) => void;
  onPermissionRequest?: (
    request: PermissionRequest,
  ) => Promise<PermissionResolution>;
}

const toolCallSchema = z.object({
  type: z.literal("tool_call"),
  tool: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});

function extractToolCall(text: string) {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const jsonFence = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (jsonFence?.[1]) {
    candidates.push(jsonFence[1].trim());
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const result = toolCallSchema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // continue
    }
  }

  return null;
}

function summarizeToolTarget(tool: string, args: Record<string, unknown>): string {
  if (tool === "exec") {
    const cmd = args.command;
    return typeof cmd === "string" ? cmd : JSON.stringify(args);
  }
  if (tool === "read_file" || tool === "write_file") {
    const target = args.path;
    return typeof target === "string" ? target : JSON.stringify(args);
  }
  return JSON.stringify(args);
}

export class AgentRunner {
  constructor(private readonly transport: ModelTransport) {}

  async run(options: AgentRunOptions): Promise<{
    text: string;
    messages: AgentMessage[];
    policy: PermissionPolicy;
  }> {
    const maxSteps = options.maxSteps ?? 8;
    let policy = normalizePolicy(options.policy);
    const toolRuntime = options.toolRuntime ?? (await createToolRuntime());

    const messages: AgentMessage[] = [
      {
        role: "system",
        content:
          "You are blah-code coding agent. Use tools when needed. If tool required, emit strict JSON tool_call object.",
      },
      { role: "user", content: options.prompt },
    ];

    try {
      for (let step = 0; step < maxSteps; step++) {
        const completion = await this.transport.complete({
          messages,
          modelId: options.modelId,
          tools: toolRuntime.listToolSpecs().map((tool) => ({
            name: tool.name,
            description: tool.description,
            schema: tool.schema,
          })),
        });

        const text = completion.text;
        const toolCall = extractToolCall(text);
        if (!toolCall) {
          messages.push({ role: "assistant", content: text });
          options.onEvent?.({ type: "assistant", payload: { text } });
          options.onEvent?.({ type: "done", payload: { reason: "completed" } });
          return { text, messages, policy };
        }

        const toolTarget = summarizeToolTarget(toolCall.tool, toolCall.arguments);
        const op = toolRuntime.permissionFor(toolCall.tool);
        let decision = evaluatePermission({
          policy,
          op,
          subject: `tool.${toolCall.tool}`,
          target: toolTarget,
        });

        if (decision === "ask" && options.onPermissionRequest) {
          const req: PermissionRequest = {
            requestId: crypto.randomUUID(),
            op,
            tool: toolCall.tool,
            target: toolTarget,
            args: toolCall.arguments,
          };

          options.onEvent?.({ type: "permission_request", payload: req });
          const resolution = await options.onPermissionRequest(req);

          decision = resolution.decision;
          if (resolution.remember) {
            policy = appendPolicyRule({
              policy,
              key: resolution.remember.key,
              pattern: resolution.remember.pattern,
              decision: resolution.remember.decision,
            });
          }

          options.onEvent?.({
            type: "permission_resolved",
            payload: {
              requestId: req.requestId,
              decision,
              remember: resolution.remember ?? null,
            },
          });
        }

        if (decision !== "allow") {
          const err = `Permission ${decision} for ${toolCall.tool}`;
          messages.push({
            role: "tool",
            content: JSON.stringify({
              tool: toolCall.tool,
              ok: false,
              error: err,
            }),
          });
          options.onEvent?.({ type: "error", payload: { message: err } });
          continue;
        }

        options.onEvent?.({ type: "tool_call", payload: toolCall });

        try {
          const result = await toolRuntime.executeTool(
            toolCall.tool,
            toolCall.arguments,
            options.cwd,
          );

          messages.push({ role: "assistant", content: JSON.stringify(toolCall) });
          messages.push({
            role: "tool",
            content: JSON.stringify({ tool: toolCall.tool, ok: true, result }),
          });
          options.onEvent?.({
            type: "tool_result",
            payload: { tool: toolCall.tool, result },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          messages.push({
            role: "tool",
            content: JSON.stringify({ tool: toolCall.tool, ok: false, error: message }),
          });
          options.onEvent?.({ type: "error", payload: { message } });
        }
      }

      const fallback = "Stopped: max steps reached";
      options.onEvent?.({ type: "done", payload: { reason: "max_steps" } });
      return { text: fallback, messages, policy };
    } finally {
      if (!options.toolRuntime) {
        await toolRuntime.close();
      }
    }
  }
}

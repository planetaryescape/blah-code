import { describe, expect, test } from "bun:test";
import { AgentRunner, type AgentEvent, type ModelTransport } from "./index";

describe("AgentRunner", () => {
  test("emits assistant delta then assistant/run_finished", async () => {
    const transport: ModelTransport = {
      async complete(input) {
        input.onDelta?.({ text: "hello " });
        input.onDelta?.({ text: "world", done: true });
        return { text: "final answer" };
      },
    };

    const runtime = {
      listToolSpecs() {
        return [];
      },
      async executeTool() {
        throw new Error("not used");
      },
      permissionFor() {
        return "read";
      },
      async close() {
        return;
      },
    };

    const events: AgentEvent[] = [];
    const runner = new AgentRunner(transport);
    const result = await runner.run({
      prompt: "test",
      modelId: "openai:gpt-5-mini",
      cwd: process.cwd(),
      toolRuntime: runtime as any,
      onEvent(event) {
        events.push(event);
      },
    });

    expect(result.text).toBe("final answer");
    expect(events.some((event) => event.type === "assistant_delta")).toBe(true);
    expect(events.some((event) => event.type === "assistant")).toBe(true);
    expect(events.some((event) => event.type === "run_finished")).toBe(true);
  });

  test("emits timeout and run_failed when model transport throws timeout", async () => {
    const transport: ModelTransport = {
      async complete() {
        throw new Error("Model response timeout after 1000ms");
      },
    };

    const runtime = {
      listToolSpecs() {
        return [];
      },
      async executeTool() {
        throw new Error("not used");
      },
      permissionFor() {
        return "read";
      },
      async close() {
        return;
      },
    };

    const events: AgentEvent[] = [];
    const runner = new AgentRunner(transport);

    await expect(
      runner.run({
        prompt: "test",
        modelId: "openai:gpt-5-mini",
        cwd: process.cwd(),
        toolRuntime: runtime as any,
        onEvent(event) {
          events.push(event);
        },
      }),
    ).rejects.toThrow("Model response timeout");

    expect(events.some((event) => event.type === "model_timeout")).toBe(true);
    expect(events.some((event) => event.type === "run_failed")).toBe(true);
  });

  test("parses tool call when preceded by prose + raw JSON later", async () => {
    let calls = 0;
    const transport: ModelTransport = {
      async complete() {
        calls++;
        if (calls === 1) {
          return {
            text: [
              "Sure, I'll use a tool.",
              "",
              '{"type":"tool_call","tool":"list_files","arguments":{"pattern":"**/*","limit":2}}',
            ].join("\n"),
          };
        }
        return { text: "done" };
      },
    };

    const executed: string[] = [];
    const runtime = {
      listToolSpecs() {
        return [{ name: "list_files", description: "List files", schema: {}, permission: "read" }];
      },
      permissionFor() {
        return "read";
      },
      async executeTool(name: string) {
        executed.push(name);
        return { ok: true };
      },
      async close() {
        return;
      },
    };

    const events: AgentEvent[] = [];
    const runner = new AgentRunner(transport);
    const result = await runner.run({
      prompt: "test",
      modelId: "openai:gpt-5-mini",
      cwd: process.cwd(),
      maxSteps: 4,
      toolRuntime: runtime as any,
      onEvent(event) {
        events.push(event);
      },
    });

    expect(result.text).toBe("done");
    expect(executed).toEqual(["list_files"]);
    expect(events.some((e) => e.type === "tool_call")).toBe(true);
    expect(events.some((e) => e.type === "tool_result")).toBe(true);
    expect(events.some((e) => e.type === "assistant")).toBe(true);
  });

  test("parses tool call inside unlabeled fenced code block", async () => {
    let calls = 0;
    const transport: ModelTransport = {
      async complete() {
        calls++;
        if (calls === 1) {
          return {
            text: ["```", '{"type":"tool_call","tool":"list_files","arguments":{}}', "```"].join(
              "\n",
            ),
          };
        }
        return { text: "ok" };
      },
    };

    const runtime = {
      listToolSpecs() {
        return [{ name: "list_files", description: "List files", schema: {}, permission: "read" }];
      },
      permissionFor() {
        return "read";
      },
      async executeTool() {
        return { ok: true };
      },
      async close() {
        return;
      },
    };

    const events: AgentEvent[] = [];
    const runner = new AgentRunner(transport);
    const result = await runner.run({
      prompt: "test",
      modelId: "openai:gpt-5-mini",
      cwd: process.cwd(),
      maxSteps: 4,
      toolRuntime: runtime as any,
      onEvent(event) {
        events.push(event);
      },
    });

    expect(result.text).toBe("ok");
    expect(events.some((e) => e.type === "tool_call")).toBe(true);
    expect(events.some((e) => e.type === "tool_result")).toBe(true);
  });

  test("parses tool call missing arguments", async () => {
    let calls = 0;
    const transport: ModelTransport = {
      async complete() {
        calls++;
        if (calls === 1) {
          return { text: '{"type":"tool_call","tool":"list_files"}' };
        }
        return { text: "ok" };
      },
    };

    const runtime = {
      listToolSpecs() {
        return [{ name: "list_files", description: "List files", schema: {}, permission: "read" }];
      },
      permissionFor() {
        return "read";
      },
      async executeTool(name: string, args: any) {
        expect(name).toBe("list_files");
        expect(args).toEqual({});
        return { ok: true };
      },
      async close() {
        return;
      },
    };

    const events: AgentEvent[] = [];
    const runner = new AgentRunner(transport);
    const result = await runner.run({
      prompt: "test",
      modelId: "openai:gpt-5-mini",
      cwd: process.cwd(),
      maxSteps: 4,
      toolRuntime: runtime as any,
      onEvent(event) {
        events.push(event);
      },
    });

    expect(result.text).toBe("ok");
    expect(events.some((e) => e.type === "tool_call")).toBe(true);
    expect(events.some((e) => e.type === "tool_result")).toBe(true);
  });
});

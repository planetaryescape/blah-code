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
});

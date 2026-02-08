import { describe, expect, test } from "bun:test";
import { BlahTransport } from "./index";

describe("BlahTransport", () => {
  test("throws explicit timeout message", async () => {
    const transport = new BlahTransport({
      apiKey: "blah_test_key",
      baseUrl: "https://blah.chat",
    }) as any;

    transport.cliRpc = async (method: string) => {
      if (method === "listMessages") return [];
      return { conversationId: "conv", userMessageId: "user" };
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      await new Promise<never>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
      throw new Error("unreachable");
    }) as unknown) as typeof fetch;

    try {
      await expect(transport.waitForAssistant("conv", "user", 10)).rejects.toThrow(
        "Model response timeout after 10ms",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

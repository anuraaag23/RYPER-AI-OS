import { describe, expect, it } from "vitest";
import { createOllamaCompatibleProvider } from "../../src/providers/local.js";
import { fakeStreamingFetch } from "./fixtures.js";
import type { StreamEvent } from "../../src/types.js";

async function collect(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

const config = { id: "local-llama", baseUrl: "http://localhost:11434", model: "llama-test" };

describe("createOllamaCompatibleProvider", () => {
  it("emits text deltas and a stop done event from newline-delimited JSON", async () => {
    const body = [
      '{"message":{"content":"Hello"},"done":false}',
      '{"message":{"content":" world"},"done":false}',
      '{"done":true,"done_reason":"stop"}',
      "",
    ].join("\n");

    const provider = createOllamaCompatibleProvider(config, fakeStreamingFetch(body));
    const events = await collect(
      provider.streamChat({ messages: [{ role: "user", content: "hi" }] }),
    );

    expect(events).toEqual([
      { type: "text_delta", delta: "Hello" },
      { type: "text_delta", delta: " world" },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("reports the local provider kind", () => {
    const provider = createOllamaCompatibleProvider(config, fakeStreamingFetch(""));
    expect(provider.kind).toBe("local");
    expect(provider.id).toBe("local-llama");
  });
});

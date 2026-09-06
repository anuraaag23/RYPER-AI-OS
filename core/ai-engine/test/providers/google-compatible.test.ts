import { describe, expect, it } from "vitest";
import { createGoogleCompatibleProvider } from "../../src/providers/google-compatible.js";
import { fakeStreamingFetch } from "./fixtures.js";
import type { StreamEvent } from "../../src/types.js";

async function collect(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

const config = {
  id: "google-gemini",
  baseUrl: "https://api.example.com/v1beta",
  apiKey: "key-test",
  model: "gemini-test",
};

describe("createGoogleCompatibleProvider", () => {
  it("emits text deltas and a stop done event", async () => {
    const body = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}',
      'data: {"candidates":[{"content":{"parts":[{"text":" world"}]},"finishReason":"STOP"}]}',
      "",
    ].join("\n\n");

    const provider = createGoogleCompatibleProvider(config, fakeStreamingFetch(body));
    const events = await collect(
      provider.streamChat({ messages: [{ role: "user", content: "hi" }] }),
    );

    expect(events).toEqual([
      { type: "text_delta", delta: "Hello" },
      { type: "text_delta", delta: " world" },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("emits a tool_call for a functionCall part and marks the turn as tool_calls", async () => {
    const body = [
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_current_time","args":{}}}]},"finishReason":"STOP"}]}',
      "",
    ].join("\n\n");

    const provider = createGoogleCompatibleProvider(config, fakeStreamingFetch(body));
    const events = await collect(
      provider.streamChat({ messages: [{ role: "user", content: "what time is it" }] }),
    );

    expect(events[0]).toMatchObject({
      type: "tool_call",
      toolCall: { name: "get_current_time", arguments: {} },
    });
    expect(events[1]).toEqual({ type: "done", finishReason: "tool_calls" });
  });
});

import { describe, expect, it } from "vitest";
import { createAnthropicCompatibleProvider } from "../../src/providers/anthropic-compatible.js";
import { fakeStreamingFetch } from "./fixtures.js";
import type { StreamEvent } from "../../src/types.js";

async function collect(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

const config = {
  id: "anthropic-claude",
  baseUrl: "https://api.example.com/v1",
  apiKey: "key-test",
  model: "claude-test",
};

describe("createAnthropicCompatibleProvider", () => {
  it("emits text deltas and a stop done event", async () => {
    const body = [
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
      "",
    ].join("\n\n");

    const provider = createAnthropicCompatibleProvider(config, fakeStreamingFetch(body));
    const events = await collect(
      provider.streamChat({ messages: [{ role: "user", content: "hi" }] }),
    );

    expect(events).toEqual([
      { type: "text_delta", delta: "Hello" },
      { type: "text_delta", delta: " world" },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("accumulates a streamed tool_use block's partial_json into one tool_call event", async () => {
    const body = [
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_current_time"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{}"}}',
      'data: {"type":"content_block_stop","index":0}',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
      "",
    ].join("\n\n");

    const provider = createAnthropicCompatibleProvider(config, fakeStreamingFetch(body));
    const events = await collect(
      provider.streamChat({ messages: [{ role: "user", content: "what time is it" }] }),
    );

    expect(events).toEqual([
      { type: "tool_call", toolCall: { id: "toolu_1", name: "get_current_time", arguments: {} } },
      { type: "done", finishReason: "tool_calls" },
    ]);
  });

  it("folds system-role messages into a single system field instead of the messages array", async () => {
    let capturedBody: string | undefined;
    const httpFetch = async (_url: string, init: { body?: string }) => {
      capturedBody = init.body;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "",
        body: () => (async function* () {})(),
      };
    };

    const provider = createAnthropicCompatibleProvider(config, httpFetch);
    await collect(
      provider.streamChat({
        messages: [
          { role: "system", content: "be concise" },
          { role: "user", content: "hi" },
        ],
      }),
    );

    const parsed = JSON.parse(capturedBody ?? "{}") as { system?: string; messages: unknown[] };
    expect(parsed.system).toBe("be concise");
    expect(parsed.messages).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { createOpenAICompatibleProvider } from "../../src/providers/openai-compatible.js";
import { fakeStreamingFetch, fakeFailingFetch } from "./fixtures.js";
import type { StreamEvent } from "../../src/types.js";

async function collect(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

const config = {
  id: "openai-gpt",
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-test",
  model: "gpt-test",
};

describe("createOpenAICompatibleProvider", () => {
  it("emits text deltas and a stop done event", async () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    const provider = createOpenAICompatibleProvider(config, fakeStreamingFetch(body));
    const events = await collect(
      provider.streamChat({ messages: [{ role: "user", content: "hi" }] }),
    );

    expect(events).toEqual([
      { type: "text_delta", delta: "Hello" },
      { type: "text_delta", delta: " world" },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("accumulates streamed tool-call argument fragments into one tool_call event", async () => {
    const body = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_current_time","arguments":""}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      "",
    ].join("\n\n");

    const provider = createOpenAICompatibleProvider(config, fakeStreamingFetch(body));
    const events = await collect(
      provider.streamChat({ messages: [{ role: "user", content: "what time is it" }] }),
    );

    expect(events).toEqual([
      { type: "tool_call_progress" },
      { type: "tool_call_progress" },
      { type: "tool_call", toolCall: { id: "call_1", name: "get_current_time", arguments: {} } },
      { type: "done", finishReason: "tool_calls" },
    ]);
  });

  it(
    "yields tool_call_progress for a hidden reasoning_content delta " +
      "(docs/adr/0022: this is what withTimeout() needs to see during a slow/thinking model's tool call)",
    async () => {
      const body = [
        'data: {"choices":[{"delta":{"reasoning_content":"the user wants the time"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_current_time","arguments":"{}"}}]},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
        "",
      ].join("\n\n");

      const provider = createOpenAICompatibleProvider(config, fakeStreamingFetch(body));
      const events = await collect(
        provider.streamChat({ messages: [{ role: "user", content: "what time is it" }] }),
      );

      expect(events).toEqual([
        { type: "tool_call_progress" },
        { type: "tool_call_progress" },
        { type: "tool_call", toolCall: { id: "call_1", name: "get_current_time", arguments: {} } },
        { type: "done", finishReason: "tool_calls" },
      ]);
    },
  );

  it("sends chat_template_kwargs.enable_thinking=false only when disableThinkingForToolCalls is set and tools are present", async () => {
    let capturedBody: string | undefined;
    const baseFetch = fakeStreamingFetch(
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    );
    const capturingFetch: typeof baseFetch = async (url, init) => {
      capturedBody = init.body;
      return baseFetch(url, init);
    };

    const provider = createOpenAICompatibleProvider(
      { ...config, disableThinkingForToolCalls: true },
      capturingFetch,
    );
    await collect(
      provider.streamChat({
        messages: [{ role: "user", content: "hi" }],
        tools: [
          {
            name: "noop",
            description: "does nothing",
            parameters: { type: "object", properties: {} },
          },
        ],
      }),
    );

    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody ?? "{}") as {
      chat_template_kwargs?: { enable_thinking?: boolean };
    };
    expect(parsed.chat_template_kwargs?.enable_thinking).toBe(false);
  });

  it("does not send chat_template_kwargs when disableThinkingForToolCalls is unset, even with tools present", async () => {
    let capturedBody: string | undefined;
    const baseFetch = fakeStreamingFetch(
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    );
    const capturingFetch: typeof baseFetch = async (url, init) => {
      capturedBody = init.body;
      return baseFetch(url, init);
    };

    const provider = createOpenAICompatibleProvider(config, capturingFetch);
    await collect(
      provider.streamChat({
        messages: [{ role: "user", content: "hi" }],
        tools: [
          {
            name: "noop",
            description: "does nothing",
            parameters: { type: "object", properties: {} },
          },
        ],
      }),
    );

    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody ?? "{}") as { chat_template_kwargs?: unknown };
    expect(parsed.chat_template_kwargs).toBeUndefined();
  });

  it("throws an HttpError-wrapping rejection on a non-ok response", async () => {
    const provider = createOpenAICompatibleProvider(
      config,
      fakeFailingFetch(401, "Unauthorized", "bad key"),
    );
    await expect(
      (async () => {
        for await (const _event of provider.streamChat({ messages: [] })) {
          // draining is enough to trigger the throw
        }
      })(),
    ).rejects.toThrow(/401/);
  });
});

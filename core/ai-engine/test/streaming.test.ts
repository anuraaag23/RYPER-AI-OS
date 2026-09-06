import { describe, expect, it } from "vitest";
import { withTimeout, withCancellation } from "../src/streaming.js";
import { EngineTimeoutError } from "../src/error-recovery.js";
import type { StreamEvent } from "../src/types.js";

async function* delayedEvents(events: StreamEvent[], delayMs: number): AsyncGenerator<StreamEvent> {
  for (const event of events) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    yield event;
  }
}

async function collect(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

describe("withTimeout", () => {
  it("passes through events that arrive within the timeout", async () => {
    const source = delayedEvents(
      [
        { type: "text_delta", delta: "a" },
        { type: "done", finishReason: "stop" },
      ],
      5,
    );
    const events = await collect(withTimeout(source, 200));
    expect(events).toHaveLength(2);
  });

  it("throws EngineTimeoutError if an event takes too long", async () => {
    const source = delayedEvents([{ type: "text_delta", delta: "a" }], 100);
    await expect(collect(withTimeout(source, 10))).rejects.toThrow(EngineTimeoutError);
  });

  it(
    "docs/adr/0022 regression: a long real event survives when bridged by " +
      "intermediate progress events, but the same total gap with no " +
      "intermediate events still times out",
    async () => {
      // Three short (5ms) gaps between four events, well under a 50ms
      // timeout individually, but summing to more than it — proving the
      // timeout is genuinely per-event/inter-event, not a total-duration
      // budget, and that OpenAICompatibleProvider's new tool_call_progress
      // heartbeats (yielded for every tool-call argument fragment) are
      // exactly what keeps a slow-but-actively-streaming tool call from
      // being mistaken for a stalled connection.
      const bridged = delayedEvents(
        [
          { type: "tool_call_progress" },
          { type: "tool_call_progress" },
          { type: "tool_call_progress" },
          { type: "tool_call", toolCall: { id: "1", name: "x", arguments: {} } },
        ],
        15,
      );
      const events = await collect(withTimeout(bridged, 50));
      expect(events).toHaveLength(4);

      // Same total elapsed time (≈45ms), but as one silent gap with
      // nothing yielded in between — this is exactly the pre-fix
      // OpenAICompatibleProvider behavior for tool calls, and correctly
      // still times out, since a genuinely stalled connection must not
      // be allowed to hide behind a large fixed timeout.
      const unbridged = delayedEvents(
        [{ type: "tool_call", toolCall: { id: "1", name: "x", arguments: {} } }],
        45,
      );
      await expect(collect(withTimeout(unbridged, 40))).rejects.toThrow(EngineTimeoutError);
    },
  );
});

describe("withCancellation", () => {
  it("passes through all events when the signal is never aborted", async () => {
    async function* source(): AsyncGenerator<StreamEvent> {
      yield { type: "text_delta", delta: "a" };
      yield { type: "done", finishReason: "stop" };
    }
    const events = await collect(withCancellation(source(), undefined));
    expect(events).toHaveLength(2);
  });

  it("stops with a cancelled done event once the signal is aborted", async () => {
    const controller = new AbortController();
    async function* source(): AsyncGenerator<StreamEvent> {
      yield { type: "text_delta", delta: "a" };
      controller.abort();
      yield { type: "text_delta", delta: "b" };
      yield { type: "text_delta", delta: "c" };
    }
    const events = await collect(withCancellation(source(), controller.signal));
    expect(events).toEqual([
      { type: "text_delta", delta: "a" },
      { type: "text_delta", delta: "b" },
      { type: "done", finishReason: "cancelled" },
    ]);
  });
});

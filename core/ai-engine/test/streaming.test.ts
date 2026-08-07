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

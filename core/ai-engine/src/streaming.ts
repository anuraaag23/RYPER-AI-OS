import type { StreamEvent } from "./types.js";
import { EngineTimeoutError } from "./error-recovery.js";

/**
 * Wraps a `StreamEvent` iterable so that if no event arrives within
 * `timeoutMs` of the previous one, iteration stops with an `EngineTimeoutError`
 * instead of hanging forever on a stalled connection.
 */
export async function* withTimeout(
  source: AsyncIterable<StreamEvent>,
  timeoutMs: number,
): AsyncGenerator<StreamEvent> {
  const iterator = source[Symbol.asyncIterator]();
  while (true) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new EngineTimeoutError(`no stream event within ${timeoutMs}ms`)),
        timeoutMs,
      );
    });

    try {
      const result = await Promise.race([iterator.next(), timeout]);
      if (result.done) return;
      yield result.value;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/**
 * Stops yielding (without throwing) once `signal` is aborted. Combined with
 * the `signal` already threaded into `ProviderChatRequest`, this lets a
 * caller cancel mid-stream and still receive a clean, event-driven stop
 * rather than an unhandled abort exception.
 */
export async function* withCancellation(
  source: AsyncIterable<StreamEvent>,
  signal: AbortSignal | undefined,
): AsyncGenerator<StreamEvent> {
  for await (const event of source) {
    yield event;
    if (signal?.aborted) {
      yield { type: "done", finishReason: "cancelled" };
      return;
    }
  }
}

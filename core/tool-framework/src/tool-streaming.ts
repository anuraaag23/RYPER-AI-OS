import type { EventBus } from "@ryper/event-bus";
import type { ToolExecutionContext, ToolStreamChunk, ToolStreamExecutor } from "./types.js";

const SOURCE = "tool-framework";

export interface StreamConsumeOptions {
  readonly onChunk?: (chunk: ToolStreamChunk) => void;
  readonly eventBus?: EventBus;
}

/**
 * Drains a streaming tool's `AsyncIterable`, tagging each yielded value
 * with a sequence number and emitting a `tool.stream.chunk` event (plus
 * calling an optional direct callback) as each arrives, then returns the
 * full ordered chunk list once the iterable completes. Respecting
 * `context.signal` is the streaming executor's own responsibility — this
 * helper just stops consuming once the signal fires so a cancelled
 * stream doesn't keep buffering chunks nobody wants.
 */
export async function consumeToolStream(
  executor: ToolStreamExecutor,
  parameters: Readonly<Record<string, unknown>>,
  context: ToolExecutionContext,
  options: StreamConsumeOptions = {},
): Promise<readonly ToolStreamChunk[]> {
  const chunks: ToolStreamChunk[] = [];
  let sequence = 0;

  for await (const data of executor(parameters, context)) {
    if (context.signal?.aborted) break;
    sequence += 1;
    const chunk: ToolStreamChunk = {
      invocationId: context.invocationId,
      sequence,
      data,
      done: false,
    };
    chunks.push(chunk);
    options.onChunk?.(chunk);
    await options.eventBus?.emit("tool.stream.chunk", chunk, SOURCE);
  }

  const finalChunk: ToolStreamChunk = {
    invocationId: context.invocationId,
    sequence: sequence + 1,
    data: undefined,
    done: true,
  };
  chunks.push(finalChunk);
  options.onChunk?.(finalChunk);
  await options.eventBus?.emit("tool.stream.chunk", finalChunk, SOURCE);

  return chunks;
}

/** Convenience: the aggregated payload of a completed stream, as an ordered array of its data chunks. */
export function collectStreamData(chunks: readonly ToolStreamChunk[]): readonly unknown[] {
  return chunks.filter((chunk) => !chunk.done).map((chunk) => chunk.data);
}

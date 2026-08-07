export interface SSEMessage {
  readonly event?: string | undefined;
  readonly data: string;
}

/**
 * Parses a raw byte stream in the `text/event-stream` framing
 * (`data: ...\n\n`, optionally preceded by `event: ...\n`) into discrete
 * messages. Shared by every provider adapter that speaks SSE, so the
 * framing logic is written and tested exactly once.
 */
export async function* parseSSEStream(body: AsyncIterable<Uint8Array>): AsyncGenerator<SSEMessage> {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });

    let separatorIndex: number;
    // Events are separated by a blank line (\n\n or \r\n\r\n).
    while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const message = parseRawEvent(rawEvent);
      if (message) yield message;
    }
  }

  const trailing = buffer.trim();
  if (trailing.length > 0) {
    const message = parseRawEvent(trailing);
    if (message) yield message;
  }
}

function parseRawEvent(rawEvent: string): SSEMessage | undefined {
  let event: string | undefined;
  const dataLines: string[] = [];

  for (const line of rawEvent.split("\n")) {
    const trimmed = line.replace(/\r$/, "");
    if (trimmed.startsWith("event:")) {
      event = trimmed.slice("event:".length).trim();
    } else if (trimmed.startsWith("data:")) {
      dataLines.push(trimmed.slice("data:".length).trim());
    }
  }

  if (dataLines.length === 0) return undefined;
  return { event, data: dataLines.join("\n") };
}

/**
 * Parses a raw byte stream framed as one JSON object per line (the format
 * Ollama's `/api/chat` streaming endpoint uses, and a common shape for
 * local inference servers in general).
 */
export async function* parseNDJSONStream(body: AsyncIterable<Uint8Array>): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        yield JSON.parse(line);
      }
    }
  }

  const trailing = buffer.trim();
  if (trailing.length > 0) {
    yield JSON.parse(trailing);
  }
}

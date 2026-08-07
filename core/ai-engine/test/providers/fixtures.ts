import type { HttpFetch, HttpResponseLike } from "../../src/providers/transport.js";

/** Splits a string into a few chunks to exercise cross-chunk buffering in the parsers. */
export async function* toByteChunks(text: string, chunkSize = 37): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  for (let i = 0; i < bytes.length; i += chunkSize) {
    yield bytes.slice(i, i + chunkSize);
  }
}

export function fakeStreamingFetch(bodyText: string, status = 200): HttpFetch {
  return async (): Promise<HttpResponseLike> => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: async () => bodyText,
    body: () => toByteChunks(bodyText),
  });
}

export function fakeFailingFetch(status: number, statusText: string, bodyText: string): HttpFetch {
  return async (): Promise<HttpResponseLike> => ({
    ok: false,
    status,
    statusText,
    text: async () => bodyText,
    body: () => null,
  });
}

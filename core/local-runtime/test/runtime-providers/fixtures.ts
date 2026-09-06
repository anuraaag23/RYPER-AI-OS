import type { HttpFetch, HttpResponseLike } from "@ryper/ai-engine";

async function* toByteChunks(text: string, chunkSize = 24): AsyncGenerator<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i += chunkSize) {
    yield bytes.slice(i, i + chunkSize);
  }
}

export function fakeTextFetch(bodyText: string, status = 200): HttpFetch {
  return async (): Promise<HttpResponseLike> => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: async () => bodyText,
    body: () => toByteChunks(bodyText),
  });
}

/** Routes based on the request path/method so a single fake fetch can serve both an availability probe and the real call. */
export function routedFetch(routes: Record<string, HttpFetch>, fallback: HttpFetch): HttpFetch {
  return async (url, init) => {
    for (const [match, handler] of Object.entries(routes)) {
      if (url.includes(match)) return handler(url, init);
    }
    return fallback(url, init);
  };
}

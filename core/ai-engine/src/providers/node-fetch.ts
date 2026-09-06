import type { HttpFetch, HttpRequestInit, HttpResponseLike } from "./transport.js";

/**
 * The real implementation of `HttpFetch` — every provider in this package
 * (`openai-compatible.ts`, `anthropic-compatible.ts`,
 * `google-compatible.ts`, `local.ts`) is constructed with an injected
 * `HttpFetch` precisely so it never has to import this directly; tests
 * inject a fake, real platform shells (`platform/desktop-app`) inject
 * this. Node 18+ ships a real, spec-compliant global `fetch` — no HTTP
 * client dependency needed.
 */
export function createNodeHttpFetch(): HttpFetch {
  return async (url: string, init: HttpRequestInit): Promise<HttpResponseLike> => {
    const response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      ...(init.body !== undefined ? { body: init.body } : {}),
      ...(init.signal !== undefined ? { signal: init.signal } : {}),
    });

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      text: () => response.text(),
      body: (): AsyncIterable<Uint8Array> | null => {
        if (!response.body) return null;
        // Node's global `fetch` Response#body is a real WHATWG
        // ReadableStream<Uint8Array>, which Node exposes as async-iterable
        // directly — no adapter needed.
        return response.body as unknown as AsyncIterable<Uint8Array>;
      },
    };
  };
}

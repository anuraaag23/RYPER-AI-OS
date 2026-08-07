/**
 * Providers never call a global `fetch` directly — they're constructed with
 * an injected `HttpFetch`. This keeps them testable with canned responses
 * and lets each platform shell supply whatever transport it has natively
 * (Node's built-in fetch, a native HTTP client bridged over IPC, etc.)
 * without this package depending on DOM lib types.
 */
export interface HttpRequestInit {
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignal | undefined;
}

export interface HttpResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  text(): Promise<string>;
  /** Async-iterable raw byte stream, present when the server streams the response body. */
  body(): AsyncIterable<Uint8Array> | null;
}

export type HttpFetch = (url: string, init: HttpRequestInit) => Promise<HttpResponseLike>;

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly bodyText: string,
  ) {
    super(`HTTP ${status} ${statusText}: ${bodyText.slice(0, 300)}`);
  }
}

export async function assertOk(response: HttpResponseLike): Promise<void> {
  if (!response.ok) {
    const bodyText = await response.text();
    throw new HttpError(response.status, response.statusText, bodyText);
  }
}

import { describe, expect, it } from "vitest";
import { assertOk, HttpError, type HttpResponseLike } from "../../src/providers/transport.js";

function fakeResponse(overrides: Partial<HttpResponseLike>): HttpResponseLike {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => "",
    body: () => null,
    ...overrides,
  };
}

describe("assertOk", () => {
  it("resolves silently for an ok response", async () => {
    await expect(assertOk(fakeResponse({ ok: true }))).resolves.toBeUndefined();
  });

  it("throws HttpError with status and body text for a non-ok response", async () => {
    const response = fakeResponse({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "rate limited",
    });
    await expect(assertOk(response)).rejects.toThrow(HttpError);
    try {
      await assertOk(response);
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(429);
      expect((err as HttpError).message).toContain("rate limited");
    }
  });
});

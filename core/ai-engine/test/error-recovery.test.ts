import { describe, expect, it, vi } from "vitest";
import { retryWithBackoff, runWithFallback, ProviderError } from "../src/error-recovery.js";

describe("retryWithBackoff", () => {
  it("returns the result on the first success without sleeping", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => "ok");
    const result = await retryWithBackoff(fn, { maxAttempts: 3, initialDelayMs: 10, sleep });
    expect(result).toBe("ok");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries on failure and eventually succeeds, sleeping with exponential backoff", async () => {
    const sleep = vi.fn(async () => {});
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient");
      return "ok";
    });

    const result = await retryWithBackoff(fn, { maxAttempts: 5, initialDelayMs: 100, sleep });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
  });

  it("throws the last error once maxAttempts is exhausted", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => {
      throw new Error("always fails");
    });
    await expect(
      retryWithBackoff(fn, { maxAttempts: 2, initialDelayMs: 10, sleep }),
    ).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry when isRetryable returns false", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => {
      throw new Error("permanent");
    });
    await expect(
      retryWithBackoff(fn, { maxAttempts: 5, initialDelayMs: 10, sleep, isRetryable: () => false }),
    ).rejects.toThrow("permanent");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("runWithFallback", () => {
  it("returns the primary result when it succeeds", async () => {
    const result = await runWithFallback(
      async () => "primary",
      async () => "fallback",
    );
    expect(result).toBe("primary");
  });

  it("returns the fallback result when the primary throws", async () => {
    const result = await runWithFallback(
      async () => {
        throw new Error("nope");
      },
      async () => "fallback",
    );
    expect(result).toBe("fallback");
  });
});

describe("ProviderError", () => {
  it("carries the provider id and underlying cause", () => {
    const cause = new Error("root cause");
    const err = new ProviderError("provider failed", "openai-gpt", cause);
    expect(err.providerId).toBe("openai-gpt");
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("ProviderError");
  });
});

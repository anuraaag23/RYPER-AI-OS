import { describe, it, expect } from "vitest";
import { sanitizeUserFacingError } from "../src/lib/user-error-sanitizer.js";

describe("sanitizeUserFacingError", () => {
  it("sanitizes completed action failures and disallows retry", () => {
    const raw = "action_completed:open_application:TypeError: failed to fetch summary";
    const res = sanitizeUserFacingError(raw);
    expect(res.message).toBe("The action was performed (opening the application), but RYPER couldn't generate a summary.");
    expect(res.canRetry).toBe(false);
    expect(res.message).not.toContain("TypeError");
    expect(res.message).not.toContain("open_application");
  });

  it("sanitizes completed power action failures", () => {
    const raw = "action_completed:get_power_info:AI stream closed";
    const res = sanitizeUserFacingError(raw);
    expect(res.message).toBe("The action was performed (checking battery and power status), but RYPER couldn't generate a summary.");
    expect(res.canRetry).toBe(false);
  });

  it("sanitizes local AI offline / connection refused and allows retry", () => {
    const raw = new Error("ProviderError: connect ECONNREFUSED 127.0.0.1:8090 at TCPConnectWrap.afterConnect");
    const res = sanitizeUserFacingError(raw);
    expect(res.message).toBe("RYPER couldn't complete that request. The local AI isn't responding right now.");
    expect(res.canRetry).toBe(true);
    expect(res.message).not.toContain("127.0.0.1");
    expect(res.message).not.toContain("8090");
    expect(res.message).not.toContain("ECONNREFUSED");
    expect(res.message).not.toContain("ProviderError");
  });

  it("sanitizes cancellation errors without retry", () => {
    const raw = new Error("AbortError: The user aborted a request.");
    const res = sanitizeUserFacingError(raw);
    expect(res.message).toBe("Request was cancelled.");
    expect(res.canRetry).toBe(false);
  });

  it("sanitizes rate limit and overload errors with retry", () => {
    const raw = "429 Too Many Requests: quota exceeded";
    const res = sanitizeUserFacingError(raw);
    expect(res.message).toBe("RYPER couldn't complete that request. The AI service is currently unavailable.");
    expect(res.canRetry).toBe(true);
  });

  it("sanitizes arbitrary technical errors without leaking internal paths or actor IDs", () => {
    const raw = new Error("InternalError: failed IPC call chat:send to actor-orchestrator-99 at C:\\Users\\user\\app\\file.ts:123:45");
    const res = sanitizeUserFacingError(raw);
    expect(res.message).toBe("RYPER couldn't complete that request.");
    expect(res.canRetry).toBe(true);
    expect(res.message).not.toContain("actor-orchestrator-99");
    expect(res.message).not.toContain("chat:send");
    expect(res.message).not.toContain("C:\\Users");
  });
});

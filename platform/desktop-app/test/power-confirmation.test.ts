import { describe, expect, it, vi } from "vitest";
import {
  PowerConfirmationManager,
  createPowerConfirmationManager,
  matchConfirmationResponse,
  tryResolvePowerConfirmation,
  POWER_CONFIRMATION_SESSION_KEY,
  POWER_ACTION_DENIED_MESSAGES,
  POWER_ACTION_CANCELLED_MESSAGES,
  POWER_ACTION_SUCCESS_MESSAGES,
} from "../electron/power-confirmation.js";

describe("PowerConfirmationManager — the real two-phase confirmation state machine", () => {
  it("has nothing pending for a session that never requested one", () => {
    const manager = new PowerConfirmationManager();
    expect(manager.hasPending("s1")).toBe(false);
    expect(manager.peek("s1")).toBeUndefined();
  });

  it("request() creates a real pending record with a unique id", () => {
    const manager = new PowerConfirmationManager();
    const record = manager.request("s1", "shutdown");
    expect(manager.hasPending("s1")).toBe(true);
    expect(manager.peek("s1")).toMatchObject({ action: "shutdown", sessionId: "s1" });
    expect(record.id).toContain("s1");
  });

  it("a second request for the same session supersedes the first — only one live confirmation per session", () => {
    const manager = new PowerConfirmationManager();
    manager.request("s1", "shutdown");
    const second = manager.request("s1", "restart");
    expect(manager.peek("s1")?.action).toBe("restart");
    expect(manager.peek("s1")?.id).toBe(second.id);
  });

  it("expires a pending confirmation once the TTL elapses, and lazily clears it", () => {
    let now = 0;
    const manager = new PowerConfirmationManager(1000, () => now);
    manager.request("s1", "sleep");
    now = 999;
    expect(manager.hasPending("s1")).toBe(true);
    now = 1001;
    expect(manager.hasPending("s1")).toBe(false);
    // Actually cleared, not just filtered on this one read.
    now = 5000;
    expect(manager.peek("s1")).toBeUndefined();
  });

  it("resolve() returns not_pending when nothing was ever requested — a bare 'yes' authorizes nothing", () => {
    const manager = new PowerConfirmationManager();
    expect(manager.resolve("s1", "confirmed")).toEqual({ outcome: "not_pending" });
  });

  it("resolve() returns expired (never confirmed) once past the TTL, even with decision 'confirmed'", () => {
    let now = 0;
    const manager = new PowerConfirmationManager(1000, () => now);
    manager.request("s1", "shutdown");
    now = 1001;
    expect(manager.resolve("s1", "confirmed")).toEqual({ outcome: "expired", action: "shutdown" });
  });

  it("resolve() clears the record — resolving twice returns not_pending the second time", () => {
    const manager = new PowerConfirmationManager();
    manager.request("s1", "shutdown");
    expect(manager.resolve("s1", "confirmed")).toEqual({
      outcome: "confirmed",
      action: "shutdown",
    });
    expect(manager.resolve("s1", "confirmed")).toEqual({ outcome: "not_pending" });
  });

  it("clear() invalidates a pending confirmation without resolving it", () => {
    const manager = new PowerConfirmationManager();
    manager.request("s1", "restart");
    manager.clear("s1");
    expect(manager.hasPending("s1")).toBe(false);
  });

  it("clearAll() invalidates every session's pending confirmation", () => {
    const manager = new PowerConfirmationManager();
    manager.request("s1", "shutdown");
    manager.request("s2", "restart");
    manager.clearAll();
    expect(manager.hasPending("s1")).toBe(false);
    expect(manager.hasPending("s2")).toBe(false);
  });

  it("createPowerConfirmationManager() is a real, working factory", () => {
    const manager = createPowerConfirmationManager();
    manager.request("s1", "sleep");
    expect(manager.hasPending("s1")).toBe(true);
  });
});

describe("matchConfirmationResponse — conservative, anchored classification", () => {
  it.each(["yes", "Yes.", "YEAH", "yep", "yup", "confirm", "confirmed", "do it", "go ahead"])(
    "recognizes %j as confirmed",
    (text) => {
      expect(matchConfirmationResponse(text)).toBe("confirmed");
    },
  );

  it.each(["no", "No.", "nope", "nah", "don't do that", "negative", "deny"])(
    "recognizes %j as denied",
    (text) => {
      expect(matchConfirmationResponse(text)).toBe("denied");
    },
  );

  it.each(["cancel", "nevermind", "never mind", "forget it", "stop", "abort"])(
    "recognizes %j as cancelled",
    (text) => {
      expect(matchConfirmationResponse(text)).toBe("cancelled");
    },
  );

  it("never treats a longer sentence that merely contains 'yes' as confirmation — the real safety property", () => {
    expect(matchConfirmationResponse("yes I think that's a good idea for later")).toBeUndefined();
    expect(matchConfirmationResponse("well yes and no")).toBeUndefined();
  });

  it("returns undefined for unrelated utterances", () => {
    expect(matchConfirmationResponse("what's the weather today")).toBeUndefined();
    expect(matchConfirmationResponse("open chrome")).toBeUndefined();
  });
});

describe("tryResolvePowerConfirmation — the shared text+voice interception point", () => {
  function noopExecute() {
    return vi.fn(async () => ({ ok: true, message: POWER_ACTION_SUCCESS_MESSAGES.shutdown }));
  }

  it("returns undefined immediately when there's no pending confirmation — message is processed normally", async () => {
    const manager = new PowerConfirmationManager();
    const execute = noopExecute();
    const result = await tryResolvePowerConfirmation("yes", manager, execute);
    expect(result).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it("an ambiguous/unrelated message clears the pending confirmation and returns undefined — never guesses", async () => {
    const manager = new PowerConfirmationManager();
    manager.request(POWER_CONFIRMATION_SESSION_KEY, "shutdown");
    const execute = noopExecute();
    const result = await tryResolvePowerConfirmation("what time is it", manager, execute);
    expect(result).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
    expect(manager.hasPending(POWER_CONFIRMATION_SESSION_KEY)).toBe(false);
  });

  it("deny resolves with the real denied message and never calls the executor", async () => {
    const manager = new PowerConfirmationManager();
    manager.request(POWER_CONFIRMATION_SESSION_KEY, "restart");
    const execute = noopExecute();
    const result = await tryResolvePowerConfirmation("no", manager, execute);
    expect(result).toEqual({ reply: POWER_ACTION_DENIED_MESSAGES.restart });
    expect(execute).not.toHaveBeenCalled();
  });

  it("cancel resolves with the real cancelled message and never calls the executor", async () => {
    const manager = new PowerConfirmationManager();
    manager.request(POWER_CONFIRMATION_SESSION_KEY, "sleep");
    const execute = noopExecute();
    const result = await tryResolvePowerConfirmation("cancel", manager, execute);
    expect(result).toEqual({ reply: POWER_ACTION_CANCELLED_MESSAGES.sleep });
    expect(execute).not.toHaveBeenCalled();
  });

  it("confirmed calls the real executor exactly once and returns its message — this is the only path that executes", async () => {
    const manager = new PowerConfirmationManager();
    manager.request(POWER_CONFIRMATION_SESSION_KEY, "shutdown");
    const execute = vi.fn(async () => ({ ok: true, message: "Shutting down." }));
    const result = await tryResolvePowerConfirmation("yes", manager, execute);
    expect(result).toEqual({ reply: "Shutting down." });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("shutdown");
  });

  it("an expired confirmation (raced between the two internal expiry checks) is never executed, even with a 'yes'", async () => {
    // `request()` calls `now()` three times (the id template, createdAt,
    // expiresAt); then `tryResolvePowerConfirmation` calls `hasPending()`
    // (1 more call — kept fresh here) before `resolve()` (1 more call —
    // pushed past the TTL). This simulates the real race
    // `tryResolvePowerConfirmation`'s "expired" branch guards against:
    // `hasPending()`'s own lazy-expiry means simply advancing time
    // *before* the whole call would just make the earlier `hasPending()`
    // guard return `undefined` instead — this is the only way to
    // actually exercise that branch.
    let callCount = 0;
    const now = (): number => {
      callCount += 1;
      if (callCount <= 3) return 0;
      if (callCount === 4) return 500;
      return 2000;
    };
    const manager = new PowerConfirmationManager(1000, now);
    manager.request(POWER_CONFIRMATION_SESSION_KEY, "shutdown");
    const execute = noopExecute();
    const result = await tryResolvePowerConfirmation("yes", manager, execute);
    expect(result?.reply).toContain("expired");
    expect(execute).not.toHaveBeenCalled();
  });

  it("a cancellation signal set before confirming rejects rather than executing the real power action", async () => {
    const manager = new PowerConfirmationManager();
    manager.request(POWER_CONFIRMATION_SESSION_KEY, "shutdown");
    const execute = noopExecute();
    const controller = new AbortController();
    controller.abort();
    await expect(
      tryResolvePowerConfirmation("yes", manager, execute, controller.signal),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it("surfaces a real executor failure as the reply instead of throwing past the caller", async () => {
    const manager = new PowerConfirmationManager();
    manager.request(POWER_CONFIRMATION_SESSION_KEY, "restart");
    const execute = vi.fn(async () => {
      throw new Error("DestructiveActionGate denied this request");
    });
    const result = await tryResolvePowerConfirmation("yes", manager, execute);
    expect(result).toEqual({ reply: "DestructiveActionGate denied this request" });
  });
});

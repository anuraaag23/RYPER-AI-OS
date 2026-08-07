import { describe, expect, it } from "vitest";
import { VoiceCommandRouter, notYetImplementedHandler } from "../src/voice-command-router.js";

describe("VoiceCommandRouter", () => {
  it("routes to a registered handler", async () => {
    const router = new VoiceCommandRouter();
    router.register({
      intent: "create_note",
      handle: () => ({ handled: true, spokenResponse: "Note created." }),
    });

    const result = await router.route(
      { intent: "create_note", slots: {}, confidence: 1 },
      { sessionId: "s1" },
    );
    expect(result).toEqual({ handled: true, spokenResponse: "Note created." });
  });

  it("returns handled: false for an intent with no registered handler at all", async () => {
    const router = new VoiceCommandRouter();
    const result = await router.route(
      { intent: "unknown_intent", slots: {}, confidence: 1 },
      { sessionId: "s1" },
    );
    expect(result).toEqual({ handled: false });
  });

  it("notYetImplementedHandler responds gracefully instead of the pipeline falling through", async () => {
    const router = new VoiceCommandRouter();
    router.register(notYetImplementedHandler("edit_pdf", "PDF editing"));
    const result = await router.route(
      { intent: "edit_pdf", slots: {}, confidence: 1 },
      { sessionId: "s1" },
    );
    expect(result.handled).toBe(true);
    expect(result.spokenResponse).toContain("PDF editing");
  });

  it("contains a throwing handler as a handled-with-apology result rather than propagating", async () => {
    const router = new VoiceCommandRouter();
    router.register({
      intent: "boom",
      handle: () => {
        throw new Error("kaboom");
      },
    });
    const result = await router.route(
      { intent: "boom", slots: {}, confidence: 1 },
      { sessionId: "s1" },
    );
    expect(result.handled).toBe(true);
    expect(result.spokenResponse).toMatch(/went wrong/);
  });

  it("rejects registering the same intent twice", () => {
    const router = new VoiceCommandRouter();
    router.register({ intent: "create_note", handle: () => ({ handled: true }) });
    expect(() =>
      router.register({ intent: "create_note", handle: () => ({ handled: true }) }),
    ).toThrow();
  });

  it("listIntents reflects every registered handler", () => {
    const router = new VoiceCommandRouter();
    router.register({ intent: "a", handle: () => ({ handled: true }) });
    router.register({ intent: "b", handle: () => ({ handled: true }) });
    expect(router.listIntents().sort()).toEqual(["a", "b"]);
  });
});

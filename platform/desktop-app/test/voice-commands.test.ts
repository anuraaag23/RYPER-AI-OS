import { describe, expect, it } from "vitest";
import { CapabilityBroker } from "@ryper/security";
import { createCapabilityManager } from "@ryper/platform-capability";
import { createWindowsAdapter } from "@ryper/windows-agent";
import { VoiceCommandRouter } from "@ryper/voice-engine";
import { registerDesktopVoiceCommands } from "../electron/voice-commands.js";
import { createPowerConfirmationManager } from "../electron/power-confirmation.js";
import { desktopActions } from "../electron/desktop-actions.js";

async function buildRouterWithRealCapabilities() {
  const broker = new CapabilityBroker(() => true);
  const capabilityManager = createCapabilityManager({ broker, platformDetector: () => "windows" });
  const adapter = await createWindowsAdapter();
  capabilityManager.registerAdapter(adapter);
  const router = new VoiceCommandRouter();
  const powerConfirmation = createPowerConfirmationManager();
  registerDesktopVoiceCommands(router, capabilityManager, powerConfirmation);
  return { router, capabilityManager, adapter, powerConfirmation };
}

describe("registerDesktopVoiceCommands", () => {
  it("opens a known application through the real CapabilityManager/WindowsAdapter", async () => {
    const { router, adapter } = await buildRouterWithRealCapabilities();
    const result = await router.route(
      { intent: "open_application", slots: { app: "calculator" }, confidence: 0.9 },
      { sessionId: "s1" },
    );
    expect(result.handled).toBe(true);
    expect(result.spokenResponse).toContain("Opening");
    // calculator (unlike notepad) is not pre-seeded as already running in the reference
    // WindowsAdapter, so this genuinely proves the launch happened.
    const running = await adapter.applicationManager.listRunning();
    expect(running.some((a) => a.appId === "microsoft.windows.calculator")).toBe(true);
  });

  it("gives an honest response for an unrecognized application/file/folder/website name", async () => {
    const { router } = await buildRouterWithRealCapabilities();
    const result = await router.route(
      { intent: "open_application", slots: { app: "some totally unknown app" }, confidence: 0.9 },
      { sessionId: "s1" },
    );
    expect(result.handled).toBe(true);
    // Real behavior since the universal-open capability (docs/adr/0030):
    // an unrecognized name now genuinely goes through `smart_open`'s
    // real classification (not a known app/browser/website, not a real
    // directory) rather than being rejected outright — the real,
    // underlying filesystem error is what's reported honestly.
    expect(result.spokenResponse).toContain("no file at");
  });

  it("increases volume via the real audio capability", async () => {
    const { router, adapter } = await buildRouterWithRealCapabilities();
    await adapter.audioManager.setVolume(50);
    const result = await router.route(
      { intent: "volume_up", slots: {}, confidence: 0.9 },
      { sessionId: "s1" },
    );
    expect(result.handled).toBe(true);
    await expect(adapter.audioManager.getVolume()).resolves.toBe(60);
  });

  it("decreases volume via the real audio capability", async () => {
    const { router, adapter } = await buildRouterWithRealCapabilities();
    await adapter.audioManager.setVolume(50);
    await router.route({ intent: "volume_down", slots: {}, confidence: 0.9 }, { sessionId: "s1" });
    await expect(adapter.audioManager.getVolume()).resolves.toBe(40);
  });

  it("sets an explicit volume level", async () => {
    const { router, adapter } = await buildRouterWithRealCapabilities();
    await router.route(
      { intent: "set_volume", slots: { percent: "77" }, confidence: 0.9 },
      { sessionId: "s1" },
    );
    await expect(adapter.audioManager.getVolume()).resolves.toBe(77);
  });

  it("mutes and unmutes via the real audio capability", async () => {
    const { router, adapter } = await buildRouterWithRealCapabilities();
    await router.route({ intent: "mute", slots: {}, confidence: 0.9 }, { sessionId: "s1" });
    await expect(adapter.audioManager.getMute()).resolves.toBe(true);
    await router.route({ intent: "unmute", slots: {}, confidence: 0.9 }, { sessionId: "s1" });
    await expect(adapter.audioManager.getMute()).resolves.toBe(false);
  });

  it("routes media transport commands", async () => {
    const { router } = await buildRouterWithRealCapabilities();
    for (const intent of ["media_play", "media_pause", "media_next", "media_previous"]) {
      const result = await router.route(
        { intent, slots: {}, confidence: 0.9 },
        { sessionId: "s1" },
      );
      expect(result.handled).toBe(true);
    }
  });

  it("power actions register a real pending confirmation and ask before doing anything", async () => {
    const { router } = await buildRouterWithRealCapabilities();
    for (const intent of ["shutdown", "restart", "sleep"]) {
      const result = await router.route(
        { intent, slots: {}, confidence: 0.9 },
        { sessionId: "s1" },
      );
      expect(result.handled).toBe(true);
      // Real behavior since the two-phase voice confirmation flow was
      // implemented (docs/adr/0031): the first request never reaches
      // `power_management` at all — it registers a pending confirmation
      // and asks the user to confirm. Only a genuine "yes" on the next
      // turn (matched in VoicePipeline.runTurn(), not exercised by this
      // router-level test) executes the real action.
      expect(result.spokenResponse.toLowerCase()).toContain("say yes to confirm");
    }
  });

  it("a power action really executes once the pending confirmation is resolved as confirmed", async () => {
    const broker = new CapabilityBroker(() => true);
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    const adapter = await createWindowsAdapter({ destructiveActionConfirmer: async () => true });
    capabilityManager.registerAdapter(adapter);
    const router = new VoiceCommandRouter();
    const powerConfirmation = createPowerConfirmationManager();
    registerDesktopVoiceCommands(router, capabilityManager, powerConfirmation);

    const requestResult = await router.route(
      { intent: "shutdown", slots: {}, confidence: 0.9 },
      { sessionId: "s1" },
    );
    expect(requestResult.handled).toBe(true);
    expect(requestResult.spokenResponse.toLowerCase()).toContain("are you sure");
    // Real evidence a pending confirmation now genuinely exists —
    // resolving it as "confirmed" is what the pipeline's own
    // interception does after matching a real "yes" (see
    // voice-pipeline.test.ts for that end-to-end path); this test
    // verifies the underlying manager + real capability call it
    // ultimately drives, at the level `registerDesktopVoiceCommands`
    // itself owns.
    const { outcome, action } = powerConfirmation.resolve(
      "voice-user", // POWER_CONFIRMATION_SESSION_KEY
      "confirmed",
    );
    expect(outcome).toBe("confirmed");
    expect(action).toBe("shutdown");

    const executeResult = await desktopActions.executeConfirmedPowerAction(
      capabilityManager,
      "voice-session",
      "shutdown",
    );
    expect(executeResult.ok).toBe(true);
    expect(executeResult.message).toBe("Shutting down.");
  });

  it("closes a running application", async () => {
    const { router, adapter } = await buildRouterWithRealCapabilities();
    await adapter.applicationManager.launch("microsoft.windows.notepad");
    const result = await router.route(
      { intent: "close_application", slots: { app: "notepad" }, confidence: 0.9 },
      { sessionId: "s1" },
    );
    expect(result.handled).toBe(true);
    const running = await adapter.applicationManager.listRunning();
    expect(running.some((a) => a.appId === "microsoft.windows.notepad")).toBe(false);
  });
});

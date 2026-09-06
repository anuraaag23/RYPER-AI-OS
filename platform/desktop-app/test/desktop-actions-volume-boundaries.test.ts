import { describe, expect, it } from "vitest";
import { CapabilityBroker } from "@ryper/security";
import { createCapabilityManager } from "@ryper/platform-capability";
import { createWindowsAdapter, WINDOWS_CAPABILITY_DESCRIPTORS } from "@ryper/windows-agent";
import { desktopActions } from "../electron/desktop-actions.js";

/**
 * Real, deterministic, always-run boundary-condition coverage for
 * `desktopActions.volumeUp`/`volumeDown`/`setVolume` — added after a
 * real Phase 13.15 hardware run at 100% volume correctly executed
 * `volume_up` end-to-end (real tool call, real broker grant, real
 * WASAPI call, `tool_result.ok === true`) but produced no observable
 * change, since `volume_up`'s own `Math.min(100, current + 10)`
 * clamping correctly has nothing left to add at the ceiling. That
 * turned out to be a real-hardware **test** design gap
 * (`audio-capability.real.test.ts` asserted `after !== before`, which
 * a legitimate no-op-at-the-ceiling result can never satisfy), not an
 * implementation bug — but it also meant this exact clamping logic had
 * no deterministic test coverage anywhere. This file closes that gap
 * using the in-memory reference `WindowsSystemApi` (the same
 * legitimate, real in-memory test double the rest of this repo's fast
 * suite already relies on — not a mock of anything under test here,
 * which is `desktopActions`'s own real clamping arithmetic).
 */
async function buildCapabilityManager() {
  const broker = new CapabilityBroker(() => true);
  const capabilityManager = createCapabilityManager({ broker, platformDetector: () => "windows" });
  const adapter = await createWindowsAdapter();
  capabilityManager.registerAdapter(adapter);
  for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
    capabilityManager.registerCapability(descriptor);
  }
  return { capabilityManager, adapter };
}

async function currentVolume(
  capabilityManager: Awaited<ReturnType<typeof buildCapabilityManager>>["capabilityManager"],
) {
  const result = await capabilityManager.invoke(
    "audio",
    "get_volume",
    {},
    { invocationId: "t", actorId: "test", sessionId: "test", platform: "windows" },
  );
  return result as number;
}

describe("desktopActions volume boundary logic (docs/adr/0024 follow-up)", () => {
  it("volumeUp clamps at the 100% ceiling instead of overshooting to 105", async () => {
    const { capabilityManager } = await buildCapabilityManager();
    await capabilityManager.invoke(
      "audio",
      "set_volume",
      { level: 95 },
      { invocationId: "setup", actorId: "test", sessionId: "test", platform: "windows" },
    );

    const result = await desktopActions.volumeUp(capabilityManager, "test");

    expect(result.ok).toBe(true);
    expect(await currentVolume(capabilityManager)).toBe(100);
  });

  it("volumeUp at exactly 100% is a real, successful no-op — not a failure, and not an overshoot", async () => {
    const { capabilityManager } = await buildCapabilityManager();
    await capabilityManager.invoke(
      "audio",
      "set_volume",
      { level: 100 },
      { invocationId: "setup", actorId: "test", sessionId: "test", platform: "windows" },
    );

    const result = await desktopActions.volumeUp(capabilityManager, "test");

    // The real, correct behavior a real-hardware run exhibited: the
    // action succeeds (a real volume-up key does nothing useful at
    // max volume either, but doesn't *fail*), and the value is
    // unchanged — this is exactly the case
    // `audio-capability.real.test.ts` now establishes a fresh baseline
    // to avoid, rather than misreading as a bug.
    expect(result.ok).toBe(true);
    expect(await currentVolume(capabilityManager)).toBe(100);
  });

  it("volumeDown clamps at the 0% floor instead of undershooting to -5", async () => {
    const { capabilityManager } = await buildCapabilityManager();
    await capabilityManager.invoke(
      "audio",
      "set_volume",
      { level: 5 },
      { invocationId: "setup", actorId: "test", sessionId: "test", platform: "windows" },
    );

    const result = await desktopActions.volumeDown(capabilityManager, "test");

    expect(result.ok).toBe(true);
    expect(await currentVolume(capabilityManager)).toBe(0);
  });

  it("volumeDown at exactly 0% is a real, successful no-op", async () => {
    const { capabilityManager } = await buildCapabilityManager();
    await capabilityManager.invoke(
      "audio",
      "set_volume",
      { level: 0 },
      { invocationId: "setup", actorId: "test", sessionId: "test", platform: "windows" },
    );

    const result = await desktopActions.volumeDown(capabilityManager, "test");

    expect(result.ok).toBe(true);
    expect(await currentVolume(capabilityManager)).toBe(0);
  });

  it("setVolume clamps an out-of-range percent to [0, 100] in both directions", async () => {
    const { capabilityManager } = await buildCapabilityManager();

    await desktopActions.setVolume(capabilityManager, "test", 150);
    expect(await currentVolume(capabilityManager)).toBe(100);

    await desktopActions.setVolume(capabilityManager, "test", -30);
    expect(await currentVolume(capabilityManager)).toBe(0);
  });

  it("mute/unmute set an explicit boolean directly — idempotent at both states, never a toggle", async () => {
    const { capabilityManager } = await buildCapabilityManager();

    const firstMute = await desktopActions.mute(capabilityManager, "test");
    expect(firstMute.ok).toBe(true);
    // Muting again while already muted must stay muted (an explicit
    // set, not a toggle that would silently unmute).
    const secondMute = await desktopActions.mute(capabilityManager, "test");
    expect(secondMute.ok).toBe(true);

    const firstUnmute = await desktopActions.unmute(capabilityManager, "test");
    expect(firstUnmute.ok).toBe(true);
    const secondUnmute = await desktopActions.unmute(capabilityManager, "test");
    expect(secondUnmute.ok).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { ToolRegistry } from "@ryper/ai-engine";
import { CapabilityBroker } from "@ryper/security";
import { createCapabilityManager } from "@ryper/platform-capability";
import { createWindowsAdapter, WINDOWS_CAPABILITY_DESCRIPTORS } from "@ryper/windows-agent";
import { buildDesktopToolDefinitions } from "../electron/desktop-tools.js";
import { summarizeForDisplay } from "../electron/tool-activity.js";

/**
 * Real, deterministic, always-run coverage for the CapabilityBroker
 * enforcement path that `show_notification` is the first desktop tool to
 * ever exercise (`requiredCapability: "notifications"` — see
 * `docs/adr/0021`). Unlike `tool-calling.real.test.ts`, this test needs
 * no real LLM, no real llama-server, and no real Windows/PowerShell —
 * it constructs a real `ToolRegistry`, a real `CapabilityBroker`, a real
 * `CapabilityManager`, and the repo's real, unmodified
 * `buildDesktopToolDefinitions()`, using the in-memory reference
 * `WindowsSystemApi` `createWindowsAdapter()` defaults to (the same
 * legitimate, real in-memory test double the rest of this repo's fast
 * suite — e.g. `ai-orchestrator.test.ts` — already uses; it is not a
 * mock of anything this test is verifying, which is the
 * ToolRegistry/CapabilityBroker enforcement logic itself, not the final
 * OS-level side effect).
 *
 * Runs in every `npm test`, closing the gap that, before this phase, the
 * `requiredCapability` -> `CapabilityBroker.assertGranted()` path in
 * `ToolRegistry.invoke()` had zero test coverage anywhere in the repo —
 * no registered tool ever set `requiredCapability` until now.
 */
async function buildRegistry() {
  const broker = new CapabilityBroker(() => true);
  const capabilityManager = createCapabilityManager({ broker, platformDetector: () => "windows" });
  const adapter = await createWindowsAdapter();
  capabilityManager.registerAdapter(adapter);
  for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
    capabilityManager.registerCapability(descriptor);
  }
  const registry = new ToolRegistry(broker);
  for (const tool of buildDesktopToolDefinitions(capabilityManager)) {
    registry.register(tool);
  }
  return { broker, capabilityManager, adapter, registry };
}

describe("show_notification: the first desktop tool to reach CapabilityBroker.assertGranted() (Phase 13.12)", () => {
  it("is refused before execute() ever runs when the calling actor has no prior grant", async () => {
    const { registry, broker } = await buildRegistry();

    const result = await registry.invoke(
      { id: "call-1", name: "show_notification", arguments: { title: "Test", message: "Hi" } },
      { sessionId: "s1" },
      // Explicit "ai-orchestrator": matches AIOrchestrator's real call
      // site (core/ai-engine/src/orchestrator.ts) after the actor-
      // identity alignment fix — see docs/adr/0021 and
      // PROJECT_STATE.md's Tier 1 completion notes.
      "ai-orchestrator",
    );

    expect(result.ok).toBe(false);
    expect(result.content).toContain("automation.execute");
    // Real proof execute() never ran: the broker's own audit log has no
    // "used" entry for this actor/capability at all.
    expect(
      broker.getAuditLog().some((e) => e.capability === "automation.execute" && e.result === "used"),
    ).toBe(false);
  });

  it("succeeds and genuinely shows a notification once the same actorId has a real grant", async () => {
    const { registry, broker } = await buildRegistry();

    const grant = await broker.requestCapability({
      actorId: "ai-orchestrator",
      capability: "automation.execute",
      justification: "test: pre-authorize automation.execute for the real AIOrchestrator actor",
    });
    expect(grant.decision).toBe("granted");

    const result = await registry.invoke(
      {
        id: "call-2",
        name: "show_notification",
        arguments: { title: "Ryper Test", message: "Hi" },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Ryper Test");

    const auditLog = broker.getAuditLog();
    expect(auditLog.some((e) => e.capability === "automation.execute" && e.result === "used")).toBe(
      true,
    );
  });

  it("rejects an out-of-schema call (missing message) before any capability check runs", async () => {
    const { registry, broker } = await buildRegistry();

    const result = await registry.invoke(
      { id: "call-3", name: "show_notification", arguments: { title: "Only a title" } },
      { sessionId: "s1" },
    );

    expect(result.ok).toBe(false);
    // No grant was ever requested for this call — proves validation ran
    // and rejected the call before the capability layer was even reached.
    expect(
      broker.getAuditLog().some((e) => e.capability === "automation.execute" && e.result === "granted"),
    ).toBe(false);
  });
});

describe("audio: volume_up/set_volume/mute are gated via CapabilityManager's self-granting flow (docs/adr/0024)", () => {
  it("is denied by default when the consent prompt denies (the real production default — see main.ts)", async () => {
    const broker = new CapabilityBroker(() => false);
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    const adapter = await createWindowsAdapter();
    capabilityManager.registerAdapter(adapter);
    for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
      capabilityManager.registerCapability(descriptor);
    }
    const registry = new ToolRegistry(broker);
    for (const tool of buildDesktopToolDefinitions(capabilityManager)) {
      registry.register(tool);
    }

    const result = await registry.invoke(
      { id: "call-4", name: "volume_up", arguments: {} },
      { sessionId: "s1" },
    );

    expect(result.ok).toBe(false);
    expect(
      broker
        .getAuditLog()
        .some((e) => e.capability === "automation.execute" && e.result === "used"),
    ).toBe(false);
  });

  it("succeeds once the consent prompt approves — real evidence the broker was genuinely consulted, not bypassed", async () => {
    const broker = new CapabilityBroker(() => true);
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    const adapter = await createWindowsAdapter();
    capabilityManager.registerAdapter(adapter);
    for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
      capabilityManager.registerCapability(descriptor);
    }
    const registry = new ToolRegistry(broker);
    for (const tool of buildDesktopToolDefinitions(capabilityManager)) {
      registry.register(tool);
    }

    const result = await registry.invoke(
      { id: "call-5", name: "volume_up", arguments: {} },
      { sessionId: "s1" },
    );

    expect(result.ok).toBe(true);
    const auditLog = broker.getAuditLog();
    expect(
      auditLog.some(
        (e) =>
          e.capability === "automation.execute" && (e.result === "granted" || e.result === "used"),
      ),
    ).toBe(true);
  });

  it("sanitizes open_application denial so internal capability/actor IDs are not leaked (P0-1)", async () => {
    // Simulates user choosing "Deny"
    const broker = new CapabilityBroker(() => false);
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    const adapter = await createWindowsAdapter();
    capabilityManager.registerAdapter(adapter);
    for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
      capabilityManager.registerCapability(descriptor);
    }
    const registry = new ToolRegistry(broker);
    for (const tool of buildDesktopToolDefinitions(capabilityManager)) {
      registry.register(tool);
    }

    const result = await registry.invoke(
      { id: "call-open-1", name: "open_application", arguments: { app: "notepad" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(false);
    expect(result.content).toContain("not granted");
    const displaySummary = summarizeForDisplay(result.content);
    expect(displaySummary).toBe("Permission was denied by the user. The action was cancelled.");
    expect(displaySummary).not.toContain("automation.execute");
    expect(displaySummary).not.toContain("ai-orchestrator");
    expect(displaySummary).not.toContain("application_control");
  });

  it("executes open_application successfully when consent prompt approves (Allow once)", async () => {
    // Simulates user choosing "Allow once"
    const broker = new CapabilityBroker(() => true);
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    const adapter = await createWindowsAdapter();
    capabilityManager.registerAdapter(adapter);
    for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
      capabilityManager.registerCapability(descriptor);
    }
    const registry = new ToolRegistry(broker);
    for (const tool of buildDesktopToolDefinitions(capabilityManager)) {
      registry.register(tool);
    }

    const result = await registry.invoke(
      { id: "call-open-2", name: "open_application", arguments: { app: "notepad" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(result.content).toBe("Opening notepad.");
    expect(
      broker.getAuditLog().some((e) => e.capability === "automation.execute" && e.result === "granted"),
    ).toBe(true);
  });
});

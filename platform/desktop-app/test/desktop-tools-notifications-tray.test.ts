import { describe, expect, it } from "vitest";
import { ToolRegistry } from "@ryper/ai-engine";
import { CapabilityBroker, type CapabilityRequest } from "@ryper/security";
import { createCapabilityManager } from "@ryper/platform-capability";
import {
  createWindowsAdapter,
  WINDOWS_CAPABILITY_DESCRIPTORS,
  createInMemoryWindowsSystemApi,
} from "@ryper/windows-agent";
import { buildDesktopToolDefinitions } from "../electron/desktop-tools.js";
import { PowerConfirmationManager } from "../electron/power-confirmation.js";
import { destroyTray } from "../electron/tray.js";
import { desktopActions } from "../electron/desktop-actions.js";

const ACTOR = "ai-orchestrator";
const ACTOR_CTX = {
  actorId: ACTOR,
  platform: "windows" as const,
  invocationId: "test-inv",
  sessionId: "s1",
};

async function buildTestRig(options?: {
  promptForConsent?: (request: CapabilityRequest) => Promise<boolean> | boolean;
}) {
  const broker = new CapabilityBroker(options?.promptForConsent ?? (() => true));
  const capabilityManager = createCapabilityManager({ broker, platformDetector: () => "windows" });
  const systemApi = createInMemoryWindowsSystemApi();

  const adapter = await createWindowsAdapter({
    systemApi,
    allowRegistryWrites: true,
  });
  capabilityManager.registerAdapter(adapter);
  for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
    capabilityManager.registerCapability(descriptor);
  }
  const powerConfirmation = new PowerConfirmationManager();
  const registry = new ToolRegistry(broker);
  for (const tool of buildDesktopToolDefinitions(
    capabilityManager,
    powerConfirmation,
    undefined,
    ACTOR,
  )) {
    registry.register(tool);
  }
  return { broker, capabilityManager, adapter, registry, systemApi, powerConfirmation };
}

describe("Windows Notifications & System Tray Security Suite", () => {
  it("1. show_notification requires automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });
    // Without prior grant, show_notification is refused before execution
    const refused = await registry.invoke(
      { id: "c1-refused", name: "show_notification", arguments: { title: "Test", message: "Body" } },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(refused.ok).toBe(false);
    expect(refused.content).toContain("automation.execute");

    // With granted capability, it succeeds
    await broker.requestCapability({
      actorId: ACTOR,
      capability: "automation.execute",
      justification: "test: show_notification authorization",
    });
    const result = await registry.invoke(
      { id: "c1", name: "show_notification", arguments: { title: "Test", message: "Body" } },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");
  });

  it("2. read-only notification operations require automation.read", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });
    const result = await registry.invoke(
      { id: "c2", name: "list_notifications", arguments: {} },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.read");
  });

  it("3. automation.read cannot invoke show_notification", async () => {
    const { registry, broker } = await buildTestRig({
      promptForConsent: (req) => req.capability === "automation.read",
    });
    // Actor only has automation.read
    await broker.requestCapability({
      actorId: ACTOR,
      capability: "automation.read",
      justification: "test: read only",
    });

    const result = await registry.invoke(
      { id: "c3", name: "show_notification", arguments: { title: "Title", message: "Message" } },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("automation.execute");
  });

  it("4. denied automation.execute blocks show_notification", async () => {
    const { registry } = await buildTestRig({
      promptForConsent: () => false,
    });
    const result = await registry.invoke(
      { id: "c4", name: "show_notification", arguments: { title: "Denied", message: "Toast" } },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("automation.execute");
  });

  it("5. notification content validation works: rejects empty title and body", async () => {
    const { capabilityManager } = await buildTestRig();
    const res1 = await desktopActions.showNotification(capabilityManager, ACTOR, "", "Valid Body");
    expect(res1.ok).toBe(false);
    expect(res1.message).toContain("both a title and a message");

    const res2 = await desktopActions.showNotification(capabilityManager, ACTOR, "Valid Title", "   ");
    expect(res2.ok).toBe(false);
    expect(res2.message).toContain("both a title and a message");
  });

  it("6. malformed notification arguments fail safely: rejects oversized and null-byte payloads", async () => {
    const { capabilityManager } = await buildTestRig();
    const longTitle = "A".repeat(300);
    const res1 = await desktopActions.showNotification(capabilityManager, ACTOR, longTitle, "Body");
    expect(res1.ok).toBe(false);
    expect(res1.message).toContain("maximum allowed length");

    const longBody = "B".repeat(2500);
    const res2 = await desktopActions.showNotification(capabilityManager, ACTOR, "Title", longBody);
    expect(res2.ok).toBe(false);
    expect(res2.message).toContain("maximum allowed length");

    const nullByte = "Title\0malicious";
    const res3 = await desktopActions.showNotification(capabilityManager, ACTOR, nullByte, "Body");
    expect(res3.ok).toBe(false);
    expect(res3.message).toContain("invalid characters");
  });

  it("7. unknown notification operations fail closed to automation.execute", async () => {
    // With consent returning false, unmapped operation fails closed because it requires automation.execute
    const { capabilityManager } = await buildTestRig({
      promptForConsent: () => false,
    });
    await expect(
      capabilityManager.invoke("notifications", "unmapped_op", {}, ACTOR_CTX),
    ).rejects.toThrow(/capability "notifications" was not granted/);
  });

  it("8. CapabilityBroker cannot be bypassed", async () => {
    const { capabilityManager, broker } = await buildTestRig({
      promptForConsent: () => false,
    });
    expect(broker.hasGrant(ACTOR, "automation.execute")).toBe(false);
    await expect(
      capabilityManager.invoke(
        "notifications",
        "show",
        { title: "Bypass", body: "Attempt", kind: "basic" },
        ACTOR_CTX,
      ),
    ).rejects.toThrow();
  });

  it("9. get_tray_status requires automation.read", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });
    const result = await registry.invoke(
      { id: "c9", name: "get_tray_status", arguments: {} },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.read");
  });

  it("10. update_tray_tooltip requires automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });
    const result = await registry.invoke(
      { id: "c10", name: "update_tray_tooltip", arguments: { tooltip: "New Tip" } },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");
  });

  it("11. unknown tray operations fail closed to automation.execute", async () => {
    const { capabilityManager } = await buildTestRig({
      promptForConsent: () => false,
    });
    await expect(
      capabilityManager.invoke("system_tray", "unknown_tray_op", {}, ACTOR_CTX),
    ).rejects.toThrow(/capability "system_tray" was not granted/);
  });

  it("12. notification failures are converted into structured tool errors", async () => {
    const { capabilityManager } = await buildTestRig();
    const res = await desktopActions.showNotification(capabilityManager, ACTOR, undefined, "msg");
    expect(res.ok).toBe(false);
    expect(typeof res.message).toBe("string");
  });

  it("13. repeated notifications succeed cleanly without duplicate leaks", async () => {
    const { registry, broker } = await buildTestRig();
    await broker.requestCapability({
      actorId: ACTOR,
      capability: "automation.execute",
      justification: "test: repeated notifications",
    });
    const r1 = await registry.invoke(
      { id: "c13-1", name: "show_notification", arguments: { title: "Turn 1", message: "Hi 1" } },
      { sessionId: "s1" },
      ACTOR,
    );
    const r2 = await registry.invoke(
      { id: "c13-2", name: "show_notification", arguments: { title: "Turn 2", message: "Hi 2" } },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it("14. list_notifications lists shown notifications with automation.read", async () => {
    const { registry, broker } = await buildTestRig();
    await broker.requestCapability({
      actorId: ACTOR,
      capability: "automation.execute",
      justification: "test: list_notifications show pre-grant",
    });
    await registry.invoke(
      { id: "c14-1", name: "show_notification", arguments: { title: "Logged Toast", message: "Logged Body" } },
      { sessionId: "s1" },
      ACTOR,
    );

    const listRes = await registry.invoke(
      { id: "c14-2", name: "list_notifications", arguments: { limit: 10 } },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(listRes.ok).toBe(true);
    expect(listRes.content).toContain("Logged Toast");
  });

  it("15. tray destruction is safe and idempotent", () => {
    expect(() => {
      destroyTray();
      destroyTray();
    }).not.toThrow();
  });

  it("16. tray tooltip updates reject empty or oversized strings", async () => {
    const { capabilityManager } = await buildTestRig();
    const resEmpty = await desktopActions.updateTrayTooltip(capabilityManager, ACTOR, "   ");
    expect(resEmpty.ok).toBe(false);
    expect(resEmpty.message).toContain("required");

    const resLong = await desktopActions.updateTrayTooltip(capabilityManager, ACTOR, "X".repeat(200));
    expect(resLong.ok).toBe(false);
    expect(resLong.message).toContain("maximum allowed length");
  });

  it("17. getTrayStatus and updateTrayTooltip operate cleanly end-to-end", async () => {
    const { registry, adapter } = await buildTestRig();
    let memoryTooltip = "Initial";
    adapter.trayManager.setHandler({
      getStatus: () => ({ created: true, tooltip: memoryTooltip, visible: true, destroyed: false }),
      setTooltip: (tip) => {
        memoryTooltip = tip;
      },
    });

    const statusRes = await registry.invoke(
      { id: "c17-1", name: "get_tray_status", arguments: {} },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(statusRes.ok).toBe(true);
    expect(statusRes.content).toContain("Initial");

    const updateRes = await registry.invoke(
      { id: "c17-2", name: "update_tray_tooltip", arguments: { tooltip: "RYPER AI Active" } },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(updateRes.ok).toBe(true);
    expect(memoryTooltip).toBe("RYPER AI Active");

    const updatedStatus = await registry.invoke(
      { id: "c17-3", name: "get_tray_status", arguments: {} },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(updatedStatus.ok).toBe(true);
    expect(updatedStatus.content).toContain("RYPER AI Active");
  });
});

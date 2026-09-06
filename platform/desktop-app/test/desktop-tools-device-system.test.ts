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

async function buildTestRig(options?: {
  promptForConsent?: (request: CapabilityRequest) => Promise<boolean> | boolean;
}) {
  const broker = new CapabilityBroker(options?.promptForConsent ?? (() => true));
  const capabilityManager = createCapabilityManager({ broker, platformDetector: () => "windows" });
  const systemApi = createInMemoryWindowsSystemApi();
  const adapter = await createWindowsAdapter({ systemApi });
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

describe("Device & System Management Capability Security", () => {
  it("1. get_system_info requires automation.read and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "sys-1", name: "get_system_info", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("System Information");
    expect(result.content).toContain("CPU");
    expect(result.content).toContain("GPU");
    expect(result.content).toContain("Memory");
    expect(requestedCaps).toContain("automation.read");
    expect(requestedCaps).not.toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.read")).toBe(true);
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(false);
  });

  it("2. list_displays requires automation.read and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "disp-1", name: "list_displays", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Connected displays");
    expect(requestedCaps).toContain("automation.read");
    expect(requestedCaps).not.toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.read")).toBe(true);
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(false);
  });

  it("3. list_audio_devices requires automation.read and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "aud-1", name: "list_audio_devices", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Available audio devices");
    expect(requestedCaps).toContain("automation.read");
    expect(requestedCaps).not.toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.read")).toBe(true);
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(false);
  });

  it("4. list_network_adapters requires automation.read and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "net-1", name: "list_network_adapters", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Network adapters");
    expect(requestedCaps).toContain("automation.read");
    expect(requestedCaps).not.toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.read")).toBe(true);
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(false);
  });

  it("5. list_devices requires automation.read and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "dev-1", name: "list_devices", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Hardware devices");
    expect(requestedCaps).toContain("automation.read");
    expect(requestedCaps).not.toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.read")).toBe(true);
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(false);
  });

  it("6. set_volume requires automation.execute and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "vol-1", name: "set_volume", arguments: { percent: 50 } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("50 percent");
    expect(requestedCaps).toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(true);
  });

  it("7. mute requires automation.execute and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "mute-1", name: "mute", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Muted");
    expect(requestedCaps).toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(true);
  });

  it("8. Actor holding only automation.read can inspect system info, displays, audio, adapters, and devices, but is BLOCKED from calling set_volume", async () => {
    const { registry } = await buildTestRig({
      promptForConsent: (req) => req.capability === "automation.read",
    });

    // System info should pass
    const sysResult = await registry.invoke(
      { id: "sys-2", name: "get_system_info", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(sysResult.ok).toBe(true);

    // Displays should pass
    const dispResult = await registry.invoke(
      { id: "disp-2", name: "list_displays", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(dispResult.ok).toBe(true);

    // Audio devices should pass
    const audResult = await registry.invoke(
      { id: "aud-2", name: "list_audio_devices", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(audResult.ok).toBe(true);

    // Network adapters should pass
    const netResult = await registry.invoke(
      { id: "net-2", name: "list_network_adapters", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(netResult.ok).toBe(true);

    // Devices should pass
    const devResult = await registry.invoke(
      { id: "dev-2", name: "list_devices", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(devResult.ok).toBe(true);

    // State-changing set_volume MUST FAIL
    const volResult = await registry.invoke(
      { id: "vol-2", name: "set_volume", arguments: { percent: 40 } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(volResult.ok).toBe(false);
    expect(volResult.content).toContain("was not granted for actor");
  });

  it("9. Denied automation.read blocks get_system_info", async () => {
    const { registry } = await buildTestRig({
      promptForConsent: () => false,
    });

    const result = await registry.invoke(
      { id: "sys-3", name: "get_system_info", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(false);
    expect(result.content).toContain("was not granted for actor");
  });

  it("10. Denied automation.read blocks list_displays", async () => {
    const { registry } = await buildTestRig({
      promptForConsent: () => false,
    });

    const result = await registry.invoke(
      { id: "disp-3", name: "list_displays", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(false);
    expect(result.content).toContain("was not granted for actor");
  });

  it("11. Denied automation.execute blocks set_volume", async () => {
    const { registry } = await buildTestRig({
      promptForConsent: () => false,
    });

    const result = await registry.invoke(
      { id: "vol-3", name: "set_volume", arguments: { percent: 70 } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(false);
    expect(result.content).toContain("was not granted for actor");
  });

  it("12. Unknown operations on device_information and display remain fail-closed", async () => {
    const requestedCaps: string[] = [];
    const { capabilityManager } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return false;
      },
    });

    // Unknown operation on device_information
    await expect(
      capabilityManager.invoke(
        "device_information",
        "unknown_device_op",
        {},
        { invocationId: "inv-12a", actorId: "ai-orchestrator", sessionId: "s1", platform: "windows" },
      ),
    ).rejects.toThrow(/was not granted/);

    // Unknown operation on display
    await expect(
      capabilityManager.invoke(
        "display",
        "unknown_display_op",
        {},
        { invocationId: "inv-12b", actorId: "ai-orchestrator", sessionId: "s1", platform: "windows" },
      ),
    ).rejects.toThrow(/was not granted/);

    expect(requestedCaps).toContain("automation.execute");
  });
});

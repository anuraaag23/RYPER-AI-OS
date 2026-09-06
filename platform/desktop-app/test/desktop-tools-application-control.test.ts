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

describe("Application Control Capability Security", () => {
  it("1. enumerate_installed requires automation.read and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "app-1", name: "list_installed_applications", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Installed applications");
    expect(requestedCaps).toContain("automation.read");
    expect(requestedCaps).not.toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.read")).toBe(true);
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(false);
  });

  it("2. enumerate_running requires automation.read and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "app-2", name: "list_running_applications", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Running applications");
    expect(requestedCaps).toContain("automation.read");
    expect(requestedCaps).not.toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.read")).toBe(true);
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(false);
  });

  it("3. list_browsers requires automation.read and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "app-3", name: "list_browsers", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.read");
    expect(requestedCaps).not.toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.read")).toBe(true);
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(false);
  });

  it("4. Read operations never request or obtain automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    await registry.invoke(
      { id: "app-4a", name: "list_installed_applications", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    await registry.invoke(
      { id: "app-4b", name: "list_running_applications", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    await registry.invoke(
      { id: "app-4c", name: "list_browsers", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(requestedCaps.every((cap) => cap === "automation.read")).toBe(true);
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(false);
  });

  it("5. launch requires automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "app-5", name: "open_application", arguments: { app: "notepad" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(true);
  });

  it("6. open_url requires automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "app-6", name: "open_url", arguments: { url: "https://example.com" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(true);
  });

  it("7. close requires automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "app-7", name: "close_application", arguments: { app: "notepad" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(true);
  });

  it("8. restart via capabilityManager requires automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { capabilityManager, broker } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    await capabilityManager.invoke(
      "application_control",
      "restart",
      { appId: "microsoft.windows.notepad" },
      { invocationId: "inv-8", actorId: "ai-orchestrator", sessionId: "s1", platform: "windows" },
    );

    expect(requestedCaps).toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(true);
  });

  it("9. automation.read alone cannot perform launch, close, restart, or open_url", async () => {
    // Grant automation.read; deny automation.execute
    const { registry, capabilityManager } = await buildTestRig({
      promptForConsent: (req) => req.capability === "automation.read",
    });

    const launchRes = await registry.invoke(
      { id: "app-9a", name: "open_application", arguments: { app: "notepad" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(launchRes.ok).toBe(false);
    expect(launchRes.content).toContain("not granted");

    const closeRes = await registry.invoke(
      { id: "app-9b", name: "close_application", arguments: { app: "notepad" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(closeRes.ok).toBe(false);
    expect(closeRes.content).toContain("not granted");

    const urlRes = await registry.invoke(
      { id: "app-9c", name: "open_url", arguments: { url: "https://example.com" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(urlRes.ok).toBe(false);
    expect(urlRes.content).toContain("not granted");

    await expect(
      capabilityManager.invoke(
        "application_control",
        "restart",
        { appId: "microsoft.windows.notepad" },
        { invocationId: "inv-9d", actorId: "ai-orchestrator", sessionId: "s1", platform: "windows" },
      ),
    ).rejects.toThrow(/not granted/);
  });

  it("10. Denied automation.read blocks read operations", async () => {
    const { registry } = await buildTestRig({
      promptForConsent: () => false,
    });

    const installedRes = await registry.invoke(
      { id: "app-10a", name: "list_installed_applications", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(installedRes.ok).toBe(false);
    expect(installedRes.content).toContain("not granted");

    const runningRes = await registry.invoke(
      { id: "app-10b", name: "list_running_applications", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(runningRes.ok).toBe(false);
    expect(runningRes.content).toContain("not granted");

    const browserRes = await registry.invoke(
      { id: "app-10c", name: "list_browsers", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(browserRes.ok).toBe(false);
    expect(browserRes.content).toContain("not granted");
  });

  it("11. Denied automation.execute blocks state-changing operations", async () => {
    const { registry } = await buildTestRig({
      promptForConsent: () => false,
    });

    const launchRes = await registry.invoke(
      { id: "app-11", name: "open_application", arguments: { app: "notepad" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(launchRes.ok).toBe(false);
    expect(launchRes.content).toContain("not granted");
  });

  it("12. Unknown operations on application_control remain fail-closed", async () => {
    const requestedCaps: string[] = [];
    const { capabilityManager } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return false;
      },
    });

    await expect(
      capabilityManager.invoke(
        "application_control",
        "some_unknown_action",
        {},
        { invocationId: "inv-12", actorId: "ai-orchestrator", sessionId: "s1", platform: "windows" },
      ),
    ).rejects.toThrow(/not granted/);

    // Verifies fail-closed fallback to requiredCapability: "automation.execute"
    expect(requestedCaps).toContain("automation.execute");
  });
});

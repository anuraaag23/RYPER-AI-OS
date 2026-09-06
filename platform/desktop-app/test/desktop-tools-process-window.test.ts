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

async function buildRegistry(options?: {
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

describe("Process and Window Management Capability Security", () => {
  it("list_processes requests and grants automation.read, never automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker } = await buildRegistry({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "p1", name: "list_processes", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Running processes");
    expect(requestedCaps).toContain("automation.read");
    expect(requestedCaps).not.toContain("automation.execute");

    expect(broker.hasGrant("ai-orchestrator", "automation.read")).toBe(true);
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(false);

    const auditLog = broker.getAuditLog();
    const grantedExecute = auditLog.some(
      (e) => e.capability === "automation.execute" && e.result === "granted",
    );
    expect(grantedExecute).toBe(false);
    const grantedRead = auditLog.some(
      (e) => e.capability === "automation.read" && e.result === "granted",
    );
    expect(grantedRead).toBe(true);
  });

  it("list_windows requests and grants automation.read, never automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker } = await buildRegistry({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "w1", name: "list_windows", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Open windows");
    expect(requestedCaps).toContain("automation.read");
    expect(requestedCaps).not.toContain("automation.execute");

    expect(broker.hasGrant("ai-orchestrator", "automation.read")).toBe(true);
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(false);
  });

  it("get_window_info requests and grants automation.read, never automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker } = await buildRegistry({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "w2", name: "get_window_info", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Open windows");
    expect(requestedCaps).toContain("automation.read");
    expect(requestedCaps).not.toContain("automation.execute");

    expect(broker.hasGrant("ai-orchestrator", "automation.read")).toBe(true);
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(false);
  });

  it("focus_window requests and grants automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker } = await buildRegistry({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "w3", name: "focus_window", arguments: { window: "notepad" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");

    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(true);

    const auditLog = broker.getAuditLog();
    const grantedExecute = auditLog.some(
      (e) => e.capability === "automation.execute" && e.result === "granted",
    );
    expect(grantedExecute).toBe(true);
  });

  it("an actor holding only automation.read is denied when attempting focus_window", async () => {
    // Only consent to automation.read; deny automation.execute
    const { registry } = await buildRegistry({
      promptForConsent: (req) => req.capability === "automation.read",
    });

    const result = await registry.invoke(
      { id: "w4", name: "focus_window", arguments: { window: "notepad" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(false);
    expect(result.content).toContain("not granted");
  });

  it("denying automation.read consent prevents listing processes and windows", async () => {
    const { registry } = await buildRegistry({
      promptForConsent: () => false,
    });

    const procResult = await registry.invoke(
      { id: "p2", name: "list_processes", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(procResult.ok).toBe(false);
    expect(procResult.content).toContain("not granted");

    const winResult = await registry.invoke(
      { id: "w5", name: "list_windows", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(winResult.ok).toBe(false);
    expect(winResult.content).toContain("not granted");
  });
});

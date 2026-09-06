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

const ACTOR_CTX = {
  actorId: "ai-orchestrator",
  platform: "windows",
  invocationId: "test-inv",
  sessionId: "s1",
};

async function buildTestRig(options?: {
  promptForConsent?: (request: CapabilityRequest) => Promise<boolean> | boolean;
  destructiveActionConfirmer?: (request: { action: string; target: string; reason: string }) => Promise<boolean>;
  allowRegistryWrites?: boolean;
}) {
  const broker = new CapabilityBroker(options?.promptForConsent ?? (() => true));
  const capabilityManager = createCapabilityManager({ broker, platformDetector: () => "windows" });
  const systemApi = createInMemoryWindowsSystemApi();

  // Seed reference data
  await systemApi.writeRegistryValue({
    hive: "HKCU",
    path: "Software\\RYPER\\Certification",
    name: "CertificationStatus",
    value: "RYPER_REGISTRY_TEST",
    valueType: "REG_SZ",
  });

  const adapter = await createWindowsAdapter({
    systemApi,
    allowRegistryWrites: options?.allowRegistryWrites ?? true,
    destructiveActionConfirmer: options?.destructiveActionConfirmer ?? (async () => true),
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
    "ai-orchestrator",
  )) {
    registry.register(tool);
  }
  return { broker, capabilityManager, adapter, registry, systemApi, powerConfirmation };
}

describe("Windows Registry Operations Security Suite", () => {
  it("1. registry read operations require automation.read", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      {
        id: "reg-1",
        name: "get_registry_value",
        arguments: {
          hive: "HKCU",
          path: "Software\\RYPER\\Certification",
          name: "CertificationStatus",
        },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.read");
  });

  it("2. registry read operations succeed when automation.read is granted", async () => {
    const { registry, broker } = await buildTestRig({
      promptForConsent: (req) => req.capability === "automation.read",
    });

    const result = await registry.invoke(
      {
        id: "reg-2",
        name: "get_registry_value",
        arguments: {
          hive: "HKCU",
          path: "Software\\RYPER\\Certification",
          name: "CertificationStatus",
        },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("RYPER_REGISTRY_TEST");
    expect(broker.hasGrant("ai-orchestrator", "automation.read")).toBe(true);
  });

  it("3. denying automation.read blocks registry reads", async () => {
    const { registry } = await buildTestRig({
      promptForConsent: () => false,
    });

    const result = await registry.invoke(
      {
        id: "reg-3",
        name: "get_registry_value",
        arguments: {
          hive: "HKCU",
          path: "Software\\RYPER\\Certification",
          name: "CertificationStatus",
        },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/not granted|denied/i);
  });

  it("4. registry reads never require automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    await registry.invoke(
      {
        id: "reg-4a",
        name: "inspect_registry_key",
        arguments: { hive: "HKCU", path: "Software\\RYPER\\Certification" },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    await registry.invoke(
      {
        id: "reg-4b",
        name: "list_registry_values",
        arguments: { hive: "HKCU", path: "Software\\RYPER\\Certification" },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(requestedCaps).not.toContain("automation.execute");
    expect(requestedCaps).toContain("automation.read");
  });

  it("5. set_registry_value operation requires automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      {
        id: "reg-5",
        name: "set_registry_value",
        arguments: {
          hive: "HKCU",
          path: "Software\\RYPER\\Certification",
          name: "TestKey",
          value: "TestVal",
        },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");
  });

  it("6. direct write operation through capabilityManager requires automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { capabilityManager } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    await capabilityManager.invoke(
      "registry",
      "set_registry_value",
      {
        hive: "HKCU",
        path: "Software\\RYPER\\Certification",
        name: "DirectKey",
        value: "DirectVal",
      },
      ACTOR_CTX,
    );

    expect(requestedCaps).toContain("automation.execute");
    expect(requestedCaps).not.toContain("automation.read");
  });

  it("7. delete operations require automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    await registry.invoke(
      {
        id: "reg-7",
        name: "delete_registry_key",
        arguments: {
          hive: "HKCU",
          path: "Software\\RYPER\\Certification\\ChildKey",
        },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(requestedCaps).toContain("automation.execute");
  });

  it("8. automation.read alone cannot write registry values", async () => {
    const { registry } = await buildTestRig({
      promptForConsent: (req) => req.capability === "automation.read",
    });

    const result = await registry.invoke(
      {
        id: "reg-8",
        name: "set_registry_value",
        arguments: {
          hive: "HKCU",
          path: "Software\\RYPER\\Certification",
          name: "ForbiddenWrite",
          value: "123",
        },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/not granted|denied/i);
  });

  it("9. automation.read alone cannot delete registry values directly", async () => {
    const { capabilityManager } = await buildTestRig({
      promptForConsent: (req) => req.capability === "automation.read",
    });

    await expect(
      capabilityManager.invoke(
        "registry",
        "delete_registry_value",
        {
          hive: "HKCU",
          path: "Software\\RYPER\\Certification",
          name: "CertificationStatus",
        },
        ACTOR_CTX,
      ),
    ).rejects.toThrow(/denied|not granted/i);
  });

  it("10. automation.read alone cannot delete registry keys", async () => {
    const { registry } = await buildTestRig({
      promptForConsent: (req) => req.capability === "automation.read",
    });

    const result = await registry.invoke(
      {
        id: "reg-10",
        name: "delete_registry_key",
        arguments: {
          hive: "HKCU",
          path: "Software\\RYPER\\Certification",
        },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/not granted|denied/i);
  });

  it("11. denied automation.execute blocks registry mutation", async () => {
    const { registry } = await buildTestRig({
      promptForConsent: () => false,
    });

    const result = await registry.invoke(
      {
        id: "reg-11",
        name: "set_registry_value",
        arguments: {
          hive: "HKCU",
          path: "Software\\RYPER\\Certification",
          name: "ShouldFail",
          value: "X",
        },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/not granted|denied/i);
  });

  it("12. destructive registry operations require explicit confirmation", async () => {
    let confirmationAsked = false;
    const { registry } = await buildTestRig({
      promptForConsent: () => true,
      destructiveActionConfirmer: async (req) => {
        confirmationAsked = true;
        expect(req.action).toBe("delete_registry_key");
        return false; // Deny confirmation
      },
    });

    const result = await registry.invoke(
      {
        id: "reg-12",
        name: "delete_registry_key",
        arguments: {
          hive: "HKCU",
          path: "Software\\RYPER\\Certification",
        },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(confirmationAsked).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/not confirmed/i);
  });

  it("13. unknown registry operations fail closed to automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { capabilityManager } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return false;
      },
    });

    await expect(
      capabilityManager.invoke(
        "registry",
        "unknown_registry_action" as any,
        {},
        ACTOR_CTX,
      ),
    ).rejects.toThrow(/not granted|denied/i);

    expect(requestedCaps).toContain("automation.execute");
  });

  it("14. CapabilityBroker cannot be bypassed", async () => {
    let brokerChecked = false;
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        brokerChecked = true;
        return true;
      },
    });

    await registry.invoke(
      {
        id: "reg-14",
        name: "inspect_registry_key",
        arguments: { hive: "HKCU", path: "Software\\RYPER\\Certification" },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(brokerChecked).toBe(true);
  });

  it("15. inspect_registry_key returns safe structured existence info", async () => {
    const { registry } = await buildTestRig({
      promptForConsent: () => true,
    });

    const result = await registry.invoke(
      {
        id: "reg-15",
        name: "inspect_registry_key",
        arguments: { hive: "HKCU", path: "Software\\RYPER\\Certification" },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Exists: Yes");
    expect(result.content).toContain("CertificationStatus");
  });

  it("16. missing registry key/value returns clear not-found message without crashing", async () => {
    const { registry } = await buildTestRig({
      promptForConsent: () => true,
    });

    const result = await registry.invoke(
      {
        id: "reg-16",
        name: "get_registry_value",
        arguments: {
          hive: "HKCU",
          path: "Software\\NonExistentPath\\12345",
          name: "NonExistentValue",
        },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("not found");
  });
});

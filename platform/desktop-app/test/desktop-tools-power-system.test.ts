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
import { desktopActions } from "../electron/desktop-actions.js";
import { PowerConfirmationManager } from "../electron/power-confirmation.js";

const ACTOR_CTX = {
  actorId: "ai-orchestrator",
  platform: "windows",
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
    destructiveActionConfirmer: async () => true,
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

describe("Power & System Control Capability Security", () => {
  it("1. get_power_status requires automation.read and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "pwr-1", name: "get_power_status", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Windows Power Information");
    expect(result.content).toContain("Power Line");
    expect(result.content).toContain("Battery");
    expect(result.content).toContain("Power Plan");
    expect(requestedCaps).toContain("automation.read");
    expect(requestedCaps).not.toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.read")).toBe(true);
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(false);
  });

  it("2. get_battery_status requires automation.read and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { capabilityManager, broker } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = (await capabilityManager.invoke(
      "power_management",
      "get_battery_status",
      {},
      ACTOR_CTX,
    )) as any;

    expect(result).toBeDefined();
    expect(result.batteryLifePercent).toBe(87);
    expect(result.isCharging).toBe(true);
    expect(requestedCaps).toContain("automation.read");
    expect(requestedCaps).not.toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.read")).toBe(true);
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(false);
  });

  it("3. get_power_plan requires automation.read and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { capabilityManager, broker } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = (await capabilityManager.invoke(
      "power_management",
      "get_power_plan",
      {},
      ACTOR_CTX,
    )) as any;

    expect(result).toBeDefined();
    expect(result.activePowerScheme).toBe("Balanced");
    expect(requestedCaps).toContain("automation.read");
    expect(requestedCaps).not.toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.read")).toBe(true);
  });

  it("4. get_system_power_state requires automation.read and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { capabilityManager, broker } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = (await capabilityManager.invoke(
      "power_management",
      "get_system_power_state",
      {},
      ACTOR_CTX,
    )) as any;

    expect(result).toBeDefined();
    expect(result.powerLineStatus).toBe("Online");
    expect(result.isPluggedIn).toBe(true);
    expect(requestedCaps).toContain("automation.read");
    expect(broker.hasGrant("ai-orchestrator", "automation.read")).toBe(true);
  });

  it("5. lock_workstation tool requires automation.execute and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker, systemApi } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "pwr-lock", name: "lock_workstation", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Workstation locked");
    expect(requestedCaps).toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(true);
    expect(systemApi.lastPowerAction).toBe("lock");
  });

  it("6. cancel_shutdown tool requires automation.execute and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { registry, broker, systemApi } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "pwr-cancel", name: "cancel_shutdown", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("cancelled");
    expect(requestedCaps).toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(true);
    expect(systemApi.lastPowerAction).toBe("cancelShutdown");
  });

  it("7. executeConfirmedPowerAction('shutdown') requires automation.execute and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { capabilityManager, broker, systemApi } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await desktopActions.executeConfirmedPowerAction(
      capabilityManager,
      "ai-orchestrator",
      "shutdown",
    );

    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(true);
    expect(systemApi.lastPowerAction).toBe("shutdown");
  });

  it("8. executeConfirmedPowerAction('restart') requires automation.execute and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { capabilityManager, broker, systemApi } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await desktopActions.executeConfirmedPowerAction(
      capabilityManager,
      "ai-orchestrator",
      "restart",
    );

    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(true);
    expect(systemApi.lastPowerAction).toBe("restart");
  });

  it("9. executeConfirmedPowerAction('sleep') requires automation.execute and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { capabilityManager, broker, systemApi } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await desktopActions.executeConfirmedPowerAction(
      capabilityManager,
      "ai-orchestrator",
      "sleep",
    );

    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(true);
    expect(systemApi.lastPowerAction).toBe("sleep");
  });

  it("10. hibernate requires automation.execute and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { capabilityManager, broker, systemApi } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    await capabilityManager.invoke(
      "power_management",
      "hibernate",
      {},
      ACTOR_CTX,
    );

    expect(requestedCaps).toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(true);
    expect(systemApi.lastPowerAction).toBe("hibernate");
  });

  it("11. sign_out requires automation.execute and succeeds when granted", async () => {
    const requestedCaps: string[] = [];
    const { capabilityManager, broker, systemApi } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    await capabilityManager.invoke(
      "power_management",
      "sign_out",
      {},
      ACTOR_CTX,
    );

    expect(requestedCaps).toContain("automation.execute");
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(true);
    expect(systemApi.lastPowerAction).toBe("signOut");
  });

  it("12. automation.read alone CANNOT execute state-changing power operations", async () => {
    const { capabilityManager, broker } = await buildTestRig({
      promptForConsent: (req) => req.capability === "automation.read",
    });

    // Read succeeds
    await expect(
      capabilityManager.invoke(
        "power_management",
        "get_power_status",
        {},
        ACTOR_CTX,
      ),
    ).resolves.toBeDefined();

    // All state-changing operations fail
    await expect(
      capabilityManager.invoke(
        "power_management",
        "lock",
        {},
        ACTOR_CTX,
      ),
    ).rejects.toThrow(/not granted/);

    await expect(
      capabilityManager.invoke(
        "power_management",
        "shutdown",
        {},
        ACTOR_CTX,
      ),
    ).rejects.toThrow(/not granted/);

    await expect(
      capabilityManager.invoke(
        "power_management",
        "restart",
        {},
        ACTOR_CTX,
      ),
    ).rejects.toThrow(/not granted/);

    await expect(
      capabilityManager.invoke(
        "power_management",
        "sleep",
        {},
        ACTOR_CTX,
      ),
    ).rejects.toThrow(/not granted/);

    await expect(
      capabilityManager.invoke(
        "power_management",
        "cancel_shutdown",
        {},
        ACTOR_CTX,
      ),
    ).rejects.toThrow(/not granted/);

    expect(broker.hasGrant("ai-orchestrator", "automation.read")).toBe(true);
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(false);
  });

  it("13. Denied automation.execute blocks state-changing tools", async () => {
    const { registry, broker } = await buildTestRig({
      promptForConsent: () => false,
    });

    const result = await registry.invoke(
      { id: "pwr-lock-denied", name: "lock_workstation", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(false);
    expect(result.content).toContain("was not granted");
    expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(false);
  });

  it("14. Unknown operations on power_management domain remain fail-closed", async () => {
    const { capabilityManager } = await buildTestRig({
      promptForConsent: (req) => req.capability === "automation.read",
    });

    await expect(
      capabilityManager.invoke(
        "power_management",
        "emergency_power_cut" as any,
        {},
        ACTOR_CTX,
      ),
    ).rejects.toThrow(/not granted/);
  });

  it("15. Conversational shutdown/restart/sleep ask for confirmation first and do not touch power_management", async () => {
    const { capabilityManager, powerConfirmation } = await buildTestRig({
      promptForConsent: () => {
        throw new Error("Capability layer should not have been called!");
      },
    });

    const shutdownRes = await desktopActions.shutdown(
      capabilityManager,
      "ai-orchestrator",
      powerConfirmation,
    );
    expect(shutdownRes.ok).toBe(true);
    expect(shutdownRes.message).toContain("Are you sure you want to shut down your PC?");
    expect(powerConfirmation.hasPending("voice-user")).toBe(true);
    expect(powerConfirmation.peek("voice-user")?.action).toBe("shutdown");

    const restartRes = await desktopActions.restart(
      capabilityManager,
      "ai-orchestrator",
      powerConfirmation,
    );
    expect(restartRes.ok).toBe(true);
    expect(restartRes.message).toContain("Are you sure you want to restart your PC?");
    expect(powerConfirmation.peek("voice-user")?.action).toBe("restart");

    const sleepRes = await desktopActions.sleep(
      capabilityManager,
      "ai-orchestrator",
      powerConfirmation,
    );
    expect(sleepRes.ok).toBe(true);
    expect(sleepRes.message).toContain("Put your PC to sleep?");
    expect(powerConfirmation.peek("voice-user")?.action).toBe("sleep");
  });
});

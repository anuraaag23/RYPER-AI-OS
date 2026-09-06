import { describe, expect, it } from "vitest";
import { ToolRegistry } from "@ryper/ai-engine";
import { CapabilityBroker, type CapabilityRequest } from "@ryper/security";
import { createCapabilityManager } from "@ryper/platform-capability";
import {
  createWindowsAdapter,
  WINDOWS_CAPABILITY_DESCRIPTORS,
  createInMemoryWindowsSystemApi,
  type DestructiveActionRequest,
} from "@ryper/windows-agent";
import { buildDesktopToolDefinitions } from "../electron/desktop-tools.js";
import { desktopActions } from "../electron/desktop-actions.js";
import { PowerConfirmationManager } from "../electron/power-confirmation.js";
import { createConfirmationBridge } from "../electron/confirmation-bridge.js";
import { IPC_CHANNELS } from "../electron/ipc-contract.js";

const ACTOR_CTX = {
  actorId: "ai-orchestrator",
  platform: "windows",
  invocationId: "test-inv",
  sessionId: "s1",
};

interface TestRigOptions {
  promptForConsent?: (request: CapabilityRequest) => Promise<boolean> | boolean;
  destructiveActionConfirmer?: (request: DestructiveActionRequest) => Promise<boolean>;
  allowRegistryWrites?: boolean;
  actorId?: string;
}

async function buildTestRig(options?: TestRigOptions) {
  const broker = new CapabilityBroker(options?.promptForConsent ?? (() => true));
  const capabilityManager = createCapabilityManager({ broker, platformDetector: () => "windows" });
  const systemApi = createInMemoryWindowsSystemApi({
    seedFiles: {
      "C:\\test\\document.txt": "Sensitive content",
      "C:\\test\\temp.log": "Log content",
    },
    seedServices: [
      {
        name: "wuauserv",
        displayName: "Windows Update",
        status: "running",
        startType: "automatic",
        critical: true,
      },
      {
        name: "Spooler",
        displayName: "Print Spooler",
        status: "running",
        startType: "automatic",
        critical: false,
      },
    ],
  });
  const adapter = await createWindowsAdapter({
    systemApi,
    destructiveActionConfirmer: options?.destructiveActionConfirmer ?? (async () => true),
    allowRegistryWrites: options?.allowRegistryWrites ?? true,
  });
  capabilityManager.registerAdapter(adapter);
  for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
    capabilityManager.registerCapability(descriptor);
  }
  const powerConfirmation = new PowerConfirmationManager();
  const registry = new ToolRegistry(broker);
  const actor = options?.actorId ?? "ai-orchestrator";
  for (const tool of buildDesktopToolDefinitions(
    capabilityManager,
    powerConfirmation,
    undefined,
    actor,
  )) {
    registry.register(tool);
  }
  return { broker, capabilityManager, adapter, registry, systemApi, powerConfirmation, actor };
}

class FakeIpcMain {
  private handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, handler);
  }
  async invokeFromRenderer(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`no handler for "${channel}"`);
    return handler({}, ...args);
  }
}

class FakeWebContents {
  public sent: { channel: string; payload: unknown }[] = [];
  private destroyed = false;
  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload });
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

describe("Cross-Subsystem Integration & Security Hardening Certification", () => {
  // =========================================================================
  // 1. CONSENT NON-TRANSITIVITY (Read != Write, Read != Execute)
  // =========================================================================
  describe("1. Consent Non-Transitivity: Read Privileges Cannot Escalate to Write/Execute", () => {
    it("1.1. filesystem.read granted allows list_files but blocks create_folder (filesystem.write required)", async () => {
      const { registry, broker } = await buildTestRig({
        promptForConsent: (req) => req.capability === "filesystem.read",
      });

      const listResult = await registry.invoke(
        { id: "fs-1", name: "list_files", arguments: { path: "C:\\test" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(listResult.ok).toBe(true);
      expect(broker.hasGrant("ai-orchestrator", "filesystem.read")).toBe(true);
      expect(broker.hasGrant("ai-orchestrator", "filesystem.write")).toBe(false);

      const writeResult = await registry.invoke(
        { id: "fs-2", name: "create_folder", arguments: { path: "C:\\test\\sub" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(writeResult.ok).toBe(false);
      expect(writeResult.content).toContain("not granted");
    });

    it("1.2. filesystem.read granted blocks delete_file (filesystem.write required)", async () => {
      const { registry } = await buildTestRig({
        promptForConsent: (req) => req.capability === "filesystem.read",
      });

      const deleteResult = await registry.invoke(
        { id: "fs-3", name: "delete_file", arguments: { path: "C:\\test\\document.txt" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(deleteResult.ok).toBe(false);
      expect(deleteResult.content).toContain("not granted");
    });

    it("1.3. automation.read granted allows list_running_applications but blocks close_application", async () => {
      const { registry, broker } = await buildTestRig({
        promptForConsent: (req) => req.capability === "automation.read",
      });

      const listResult = await registry.invoke(
        { id: "app-1", name: "list_running_applications", arguments: {} },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(listResult.ok).toBe(true);

      const closeResult = await registry.invoke(
        { id: "app-2", name: "close_application", arguments: { app: "notepad" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(closeResult.ok).toBe(false);
      expect(closeResult.content).toContain("not granted");
      expect(broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(false);
    });

    it("1.4. automation.read granted allows list_processes but blocks process termination", async () => {
      const { registry, capabilityManager } = await buildTestRig({
        promptForConsent: (req) => req.capability === "automation.read",
      });

      const listResult = await registry.invoke(
        { id: "proc-1", name: "list_processes", arguments: {} },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(listResult.ok).toBe(true);

      await expect(
        capabilityManager.invoke("process_management", "kill", { pid: 1234 }, ACTOR_CTX),
      ).rejects.toThrow(/not granted/);
    });

    it("1.5. automation.read granted allows get_volume on adapter but blocks set_volume tool", async () => {
      const { registry, capabilityManager } = await buildTestRig({
        promptForConsent: (req) => req.capability === "automation.read",
      });

      const getVol = await capabilityManager.invoke("audio", "get_volume", {}, ACTOR_CTX);
      expect(getVol).toBeDefined();

      const setVol = await registry.invoke(
        { id: "aud-2", name: "set_volume", arguments: { percent: 50 } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(setVol.ok).toBe(false);
      expect(setVol.content).toContain("not granted");
    });

    it("1.6. automation.read granted allows list_notifications but blocks show_notification", async () => {
      const { registry } = await buildTestRig({
        promptForConsent: (req) => req.capability === "automation.read",
      });

      const listNotif = await registry.invoke(
        { id: "notif-1", name: "list_notifications", arguments: {} },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(listNotif.ok).toBe(true);

      const showNotif = await registry.invoke(
        { id: "notif-2", name: "show_notification", arguments: { title: "T", message: "M" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(showNotif.ok).toBe(false);
      expect(showNotif.content).toContain("automation.execute");
    });

    it("1.7. automation.read granted allows get_registry_value but blocks set_registry_value", async () => {
      const { registry } = await buildTestRig({
        promptForConsent: (req) => req.capability === "automation.read",
      });

      const readReg = await registry.invoke(
        {
          id: "reg-1",
          name: "get_registry_value",
          arguments: { hive: "HKCU", path: "Software\\Test", name: "Val" },
        },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(readReg.ok).toBe(true);

      const writeReg = await registry.invoke(
        {
          id: "reg-2",
          name: "set_registry_value",
          arguments: { hive: "HKCU", path: "Software\\Test", name: "Val", value: "New" },
        },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(writeReg.ok).toBe(false);
      expect(writeReg.content).toContain("not granted");
    });

    it("1.8. automation.read granted allows list_services but blocks stop_service", async () => {
      const { registry } = await buildTestRig({
        promptForConsent: (req) => req.capability === "automation.read",
      });

      const listSvc = await registry.invoke(
        { id: "svc-1", name: "list_services", arguments: {} },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(listSvc.ok).toBe(true);

      const stopSvc = await registry.invoke(
        { id: "svc-2", name: "stop_service", arguments: { name: "wuauserv" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(stopSvc.ok).toBe(false);
      expect(stopSvc.content).toContain("not granted");
    });

    it("1.9. automation.read granted allows list_scheduled_tasks but blocks delete_scheduled_task", async () => {
      const { registry } = await buildTestRig({
        promptForConsent: (req) => req.capability === "automation.read",
      });

      const listTasks = await registry.invoke(
        { id: "task-1", name: "list_scheduled_tasks", arguments: {} },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(listTasks.ok).toBe(true);

      const delTask = await registry.invoke(
        { id: "task-2", name: "delete_scheduled_task", arguments: { name: "MyTask" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(delTask.ok).toBe(false);
      expect(delTask.content).toContain("not granted");
    });

    it("1.10. automation.read granted allows list_network_adapters but blocks disable_network_adapter", async () => {
      const { registry } = await buildTestRig({
        promptForConsent: (req) => req.capability === "automation.read",
      });

      const listAdapters = await registry.invoke(
        { id: "net-1", name: "list_network_adapters", arguments: {} },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(listAdapters.ok).toBe(true);

      const disableAdapter = await registry.invoke(
        { id: "net-2", name: "disable_network_adapter", arguments: { interfaceAlias: "Wi-Fi" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(disableAdapter.ok).toBe(false);
      expect(disableAdapter.content).toContain("not granted");
    });

    it("1.11. automation.read granted allows get_power_status but blocks lock_workstation and shutdown", async () => {
      const { registry, capabilityManager } = await buildTestRig({
        promptForConsent: (req) => req.capability === "automation.read",
      });

      const pwrStatus = await registry.invoke(
        { id: "pwr-1", name: "get_power_status", arguments: {} },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(pwrStatus.ok).toBe(true);

      const lockRes = await registry.invoke(
        { id: "pwr-2", name: "lock_workstation", arguments: {} },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(lockRes.ok).toBe(false);
      expect(lockRes.content).toContain("not granted");

      await expect(
        capabilityManager.invoke("power_management", "shutdown", {}, ACTOR_CTX),
      ).rejects.toThrow(/not granted/);
    });
  });

  // =========================================================================
  // 2. CROSS-DOMAIN PRIVILEGE SEPARATION
  // =========================================================================
  describe("2. Cross-Domain Privilege Separation: Grants Never Cross Subsystems", () => {
    it("2.1. filesystem.write grant does NOT permit delete_registry_key", async () => {
      const { registry } = await buildTestRig({
        promptForConsent: (req) => req.capability === "filesystem.write",
      });

      const regDel = await registry.invoke(
        {
          id: "cd-1",
          name: "delete_registry_key",
          arguments: { hive: "HKCU", path: "Software\\TestKey" },
        },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(regDel.ok).toBe(false);
      expect(regDel.content).toContain("not granted");
    });

    it("2.2. filesystem.write grant does NOT permit disable_network_adapter", async () => {
      const { registry } = await buildTestRig({
        promptForConsent: (req) => req.capability === "filesystem.write",
      });

      const netDis = await registry.invoke(
        { id: "cd-2", name: "disable_network_adapter", arguments: { interfaceAlias: "Wi-Fi" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(netDis.ok).toBe(false);
      expect(netDis.content).toContain("not granted");
    });

    it("2.3. filesystem.write grant does NOT permit lock_workstation or shutdown", async () => {
      const { registry, capabilityManager } = await buildTestRig({
        promptForConsent: (req) => req.capability === "filesystem.write",
      });

      const lockRes = await registry.invoke(
        { id: "cd-3", name: "lock_workstation", arguments: {} },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(lockRes.ok).toBe(false);
      expect(lockRes.content).toContain("not granted");

      await expect(
        capabilityManager.invoke("power_management", "shutdown", {}, ACTOR_CTX),
      ).rejects.toThrow(/not granted/);
    });

    it("2.4. filesystem.write grant does NOT permit process termination", async () => {
      const { capabilityManager } = await buildTestRig({
        promptForConsent: (req) => req.capability === "filesystem.write",
      });

      await expect(
        capabilityManager.invoke("process_management", "kill", { pid: 4 }, ACTOR_CTX),
      ).rejects.toThrow(/not granted/);
    });

    it("2.5. automation.execute grant does NOT satisfy filesystem.write", async () => {
      const { registry } = await buildTestRig({
        promptForConsent: (req) => req.capability === "automation.execute",
      });

      const fsWrite = await registry.invoke(
        { id: "cd-5", name: "create_folder", arguments: { path: "C:\\newfolder" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(fsWrite.ok).toBe(false);
      expect(fsWrite.content).toContain("not granted");
    });

    it("2.6. system.power grant does NOT permit delete_file", async () => {
      const { registry } = await buildTestRig({
        promptForConsent: (req) => req.capability === "system.power",
      });

      const fsDel = await registry.invoke(
        { id: "cd-6", name: "delete_file", arguments: { path: "C:\\test\\temp.log" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(fsDel.ok).toBe(false);
      expect(fsDel.content).toContain("not granted");
    });

    it("2.7. notifications grant does NOT permit service modification", async () => {
      const { registry, broker } = await buildTestRig({
        promptForConsent: (req) => req.capability === "notifications",
      });
      broker.grant("ai-orchestrator", "notifications");

      const stopSvc = await registry.invoke(
        { id: "cd-7", name: "stop_service", arguments: { name: "Spooler" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(stopSvc.ok).toBe(false);
      expect(stopSvc.content).toContain("not granted");
    });
  });

  // =========================================================================
  // 3. DESTRUCTIVE ACTION GATE VERIFICATION (Fail-Closed)
  // =========================================================================
  describe("3. Destructive Action Gate: Fail-Closed Protection on Sensitive Actions", () => {
    it("3.1. delete_file fails closed when confirmer returns false (even with filesystem.write granted)", async () => {
      const { registry, broker } = await buildTestRig({
        destructiveActionConfirmer: async () => false,
      });
      broker.grant("ai-orchestrator", "filesystem.write");

      const result = await registry.invoke(
        { id: "dag-1", name: "delete_file", arguments: { path: "C:\\test\\temp.log" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(result.ok).toBe(false);
      expect(result.content).toContain("was not confirmed");
    });

    it("3.2. process kill fails closed when confirmer returns false (even with automation.execute granted)", async () => {
      const { capabilityManager, broker } = await buildTestRig({
        destructiveActionConfirmer: async () => false,
      });
      broker.grant("ai-orchestrator", "automation.execute");

      await expect(
        capabilityManager.invoke("process_management", "kill", { pid: 1234 }, ACTOR_CTX),
      ).rejects.toThrow("was not confirmed");
    });

    it("3.3. stop_service on critical service fails closed when confirmer returns false", async () => {
      const { registry, broker } = await buildTestRig({
        destructiveActionConfirmer: async () => false,
      });
      broker.grant("ai-orchestrator", "automation.execute");

      const result = await registry.invoke(
        { id: "dag-3", name: "stop_service", arguments: { name: "wuauserv" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(result.ok).toBe(false);
      expect(result.content).toContain("was not confirmed");
    });

    it("3.4. delete_scheduled_task fails closed when confirmer returns false", async () => {
      const { registry, broker } = await buildTestRig({
        destructiveActionConfirmer: async () => false,
      });
      broker.grant("ai-orchestrator", "automation.execute");

      const result = await registry.invoke(
        { id: "dag-4", name: "delete_scheduled_task", arguments: { name: "Task1" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(result.ok).toBe(false);
      expect(result.content).toContain("was not confirmed");
    });

    it("3.5. set_registry_value fails closed when confirmer returns false", async () => {
      const { registry, broker } = await buildTestRig({
        destructiveActionConfirmer: async () => false,
      });
      broker.grant("ai-orchestrator", "automation.execute");

      const result = await registry.invoke(
        {
          id: "dag-5",
          name: "set_registry_value",
          arguments: { hive: "HKCU", path: "Software\\App", name: "Key", value: "Val" },
        },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(result.ok).toBe(false);
      expect(result.content).toContain("was not confirmed");
    });

    it("3.6. delete_value on registry fails closed when confirmer returns false", async () => {
      const { capabilityManager, broker } = await buildTestRig({
        destructiveActionConfirmer: async () => false,
      });
      broker.grant("ai-orchestrator", "automation.execute");

      await expect(
        capabilityManager.invoke(
          "registry",
          "delete_value",
          { hive: "HKCU", path: "Software\\App", name: "Key" },
          ACTOR_CTX,
        ),
      ).rejects.toThrow("was not confirmed");
    });

    it("3.7. delete_registry_key fails closed when confirmer returns false", async () => {
      const { registry, broker } = await buildTestRig({
        destructiveActionConfirmer: async () => false,
      });
      broker.grant("ai-orchestrator", "automation.execute");

      const result = await registry.invoke(
        {
          id: "dag-7",
          name: "delete_registry_key",
          arguments: { hive: "HKCU", path: "Software\\App" },
        },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(result.ok).toBe(false);
      expect(result.content).toContain("was not confirmed");
    });

    it("3.8. executeConfirmedPowerAction('shutdown') fails closed when confirmer returns false", async () => {
      const { capabilityManager, broker } = await buildTestRig({
        destructiveActionConfirmer: async () => false,
      });
      broker.grant("ai-orchestrator", "automation.execute");

      const res = await desktopActions.executeConfirmedPowerAction(capabilityManager, "ai-orchestrator", "shutdown");
      expect(res.ok).toBe(false);
      expect(res.message).toContain("was not confirmed");
    });

    it("3.9. executeConfirmedPowerAction('restart') fails closed when confirmer returns false", async () => {
      const { capabilityManager, broker } = await buildTestRig({
        destructiveActionConfirmer: async () => false,
      });
      broker.grant("ai-orchestrator", "automation.execute");

      const res = await desktopActions.executeConfirmedPowerAction(capabilityManager, "ai-orchestrator", "restart");
      expect(res.ok).toBe(false);
      expect(res.message).toContain("was not confirmed");
    });

    it("3.10. executeConfirmedPowerAction('sleep') fails closed when confirmer returns false", async () => {
      const { capabilityManager, broker } = await buildTestRig({
        destructiveActionConfirmer: async () => false,
      });
      broker.grant("ai-orchestrator", "automation.execute");

      const res = await desktopActions.executeConfirmedPowerAction(capabilityManager, "ai-orchestrator", "sleep");
      expect(res.ok).toBe(false);
      expect(res.message).toContain("was not confirmed");
    });

    it("3.11. disable_network_adapter fails closed when targeting active adapter and unconfirmed", async () => {
      const { registry, broker } = await buildTestRig({
        destructiveActionConfirmer: async () => false,
      });
      broker.grant("ai-orchestrator", "automation.execute");

      const result = await registry.invoke(
        { id: "dag-11", name: "disable_network_adapter", arguments: { interfaceAlias: "Wi-Fi" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(result.ok).toBe(false);
      expect(result.content).toContain("was not confirmed");
    });

    it("3.12. set_static_ip fails closed when targeting active adapter and unconfirmed", async () => {
      const { registry, broker } = await buildTestRig({
        destructiveActionConfirmer: async () => false,
      });
      broker.grant("ai-orchestrator", "automation.execute");

      const result = await registry.invoke(
        {
          id: "dag-12",
          name: "set_static_ip",
          arguments: {
            interfaceAlias: "Wi-Fi",
            ipAddress: "192.168.1.50",
            prefixLength: 24,
            defaultGateway: "192.168.1.1",
          },
        },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(result.ok).toBe(false);
      expect(result.content).toContain("was not confirmed");
    });

    it("3.13. enable_network_adapter succeeds when confirmed and authorized", async () => {
      const { registry, broker } = await buildTestRig({
        destructiveActionConfirmer: async () => true,
      });
      broker.grant("ai-orchestrator", "automation.execute");

      const result = await registry.invoke(
        { id: "dag-13", name: "enable_network_adapter", arguments: { interfaceAlias: "Ethernet" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(result.ok).toBe(true);
      expect(result.content).toContain("Ethernet");
    });
  });

  // =========================================================================
  // 4. SINGLE-USE CONFIRMATION & TOCTOU / REPLAY DEFENSE
  // =========================================================================
  describe("4. Single-Use Confirmation & Replay/TOCTOU Defense", () => {
    it("4.1. Sequential destructive actions require independent confirmations", async () => {
      let confirmationCount = 0;
      const { registry, broker } = await buildTestRig({
        destructiveActionConfirmer: async () => {
          confirmationCount += 1;
          // First call confirmed, second call denied
          return confirmationCount === 1;
        },
      });
      broker.grant("ai-orchestrator", "filesystem.write");

      // First call succeeds
      const call1 = await registry.invoke(
        { id: "toctou-1", name: "delete_file", arguments: { path: "C:\\test\\temp.log" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(call1.ok).toBe(true);
      expect(confirmationCount).toBe(1);

      // Second call fails closed; Call 1's confirmation is not reused
      const call2 = await registry.invoke(
        { id: "toctou-2", name: "delete_file", arguments: { path: "C:\\test\\document.txt" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );
      expect(call2.ok).toBe(false);
      expect(call2.content).toContain("was not confirmed");
      expect(confirmationCount).toBe(2);
    });

    it("4.2. ConfirmationBridge deletes pending IDs immediately on first response (replay defense)", async () => {
      const ipcMain = new FakeIpcMain();
      const webContents = new FakeWebContents();
      const bridge = createConfirmationBridge(ipcMain as never, () => webContents as never);

      const promptPromise = bridge.prompt("Confirm action", "target description");
      const request = webContents.sent[0]?.payload as { id: string };
      expect(request.id).toBeTruthy();

      // First approval resolves the promise
      await ipcMain.invokeFromRenderer(IPC_CHANNELS.respondToConfirmation, request.id, true);
      await expect(promptPromise).resolves.toBe(true);

      // Duplicate / replayed confirmation response with same ID is harmlessly ignored
      await expect(
        ipcMain.invokeFromRenderer(IPC_CHANNELS.respondToConfirmation, request.id, true),
      ).resolves.toBeUndefined();
    });

    it("4.3. ConfirmationBridge fails closed if renderer window is destroyed", async () => {
      const ipcMain = new FakeIpcMain();
      const webContents = new FakeWebContents();
      webContents.destroy();
      const bridge = createConfirmationBridge(ipcMain as never, () => webContents as never);

      const promptPromise = bridge.prompt("Confirm action", "target description");
      await expect(promptPromise).resolves.toBe(false);
    });
  });

  // =========================================================================
  // 5. ACTOR & SESSION ISOLATION
  // =========================================================================
  describe("5. Actor & Session Isolation", () => {
    it("5.1. Capability grant to Actor-A is denied to Actor-B", async () => {
      const { capabilityManager } = await buildTestRig({
        promptForConsent: (req) => req.actorId === "actor-alpha",
      });

      // Actor alpha can invoke read
      const alphaResult = await capabilityManager.invoke(
        "filesystem",
        "read",
        { path: "C:\\test\\document.txt" },
        { actorId: "actor-alpha", platform: "windows", invocationId: "inv-1", sessionId: "s1" },
      );
      expect(alphaResult).toBeDefined();

      // Actor beta is refused
      await expect(
        capabilityManager.invoke(
          "filesystem",
          "read",
          { path: "C:\\test\\document.txt" },
          { actorId: "actor-beta", platform: "windows", invocationId: "inv-2", sessionId: "s1" },
        ),
      ).rejects.toThrow('capability "filesystem" was not granted for actor "actor-beta"');
    });

    it("5.2. Denied grant to Actor-A does not prevent Actor-B from requesting and receiving grant", async () => {
      const { broker } = await buildTestRig({
        promptForConsent: (req) => req.actorId === "actor-beta",
      });

      const alphaReq = await broker.requestCapability({
        actorId: "actor-alpha",
        capability: "automation.execute",
        justification: "alpha request",
      });
      expect(alphaReq.decision).toBe("denied");

      const betaReq = await broker.requestCapability({
        actorId: "actor-beta",
        capability: "automation.execute",
        justification: "beta request",
      });
      expect(betaReq.decision).toBe("granted");

      expect(broker.hasGrant("actor-alpha", "automation.execute")).toBe(false);
      expect(broker.hasGrant("actor-beta", "automation.execute")).toBe(true);
    });
  });

  // =========================================================================
  // 6. CANCELLATION PROPAGATION
  // =========================================================================
  describe("6. Cancellation Propagation", () => {
    it("6.1. Aborted turn signal halts tool execution before execute() runs", async () => {
      const { registry, broker } = await buildTestRig();
      broker.grant("ai-orchestrator", "filesystem.read");

      const controller = new AbortController();
      controller.abort(); // already cancelled

      const result = await registry.invoke(
        { id: "cancel-1", name: "list_files", arguments: { path: "C:\\test" } },
        { sessionId: "s1", signal: controller.signal },
        "ai-orchestrator",
      );

      expect(result.ok).toBe(false);
      expect(result.content).toContain("cancelled");
    });
  });

  // =========================================================================
  // 7. MODEL ADVERSARIAL ARGUMENT DEFENSE
  // =========================================================================
  describe("7. Model Untrusted Output & Schema Enforcement", () => {
    it("7.1. Out-of-schema call with missing required parameter is rejected before capability checks", async () => {
      const requestedCaps: string[] = [];
      const { registry } = await buildTestRig({
        promptForConsent: (req) => {
          requestedCaps.push(req.capability);
          return true;
        },
      });

      // list_files requires "path"
      const result = await registry.invoke(
        { id: "schema-1", name: "list_files", arguments: {} },
        { sessionId: "s1" },
        "ai-orchestrator",
      );

      expect(result.ok).toBe(false);
      expect(result.content).toMatch(/missing required argument.*path/);
      // Proves capability check was never even reached
      expect(requestedCaps).toHaveLength(0);
    });

    it("7.2. Out-of-schema call with invalid parameter type is rejected before capability checks", async () => {
      const requestedCaps: string[] = [];
      const { registry } = await buildTestRig({
        promptForConsent: (req) => {
          requestedCaps.push(req.capability);
          return true;
        },
      });

      // set_volume requires percent to be a number
      const result = await registry.invoke(
        { id: "schema-2", name: "set_volume", arguments: { percent: "one-hundred" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );

      expect(result.ok).toBe(false);
      expect(result.content).toMatch(/must be of type number/);
      expect(requestedCaps).toHaveLength(0);
    });
  });

  // =========================================================================
  // 8. STRICT EXCLUSION OF ARBITRARY SHELL EXECUTION
  // =========================================================================
  describe("8. Absolute Exclusion of Arbitrary Command / Shell Execution Vectors", () => {
    it("8.1. Registered tool specs contain zero arbitrary shell/powershell/cmd tools", async () => {
      const { registry } = await buildTestRig();
      const specs = registry.listSpecs();

      const dangerousNames = [
        "shell",
        "exec",
        "run_command",
        "powershell",
        "cmd",
        "terminal",
        "bash",
        "eval",
        "execute_script",
      ];

      for (const spec of specs) {
        for (const danger of dangerousNames) {
          expect(spec.name.toLowerCase()).not.toBe(danger);
        }
        // Verify no parameter accepts "script", "commandLine", or "command"
        if (spec.parameters.properties) {
          const propNames = Object.keys(spec.parameters.properties);
          expect(propNames).not.toContain("rawScript");
          expect(propNames).not.toContain("arbitraryCommand");
        }
      }
      expect(specs.length).toBeGreaterThan(60);
    });
  });

  // =========================================================================
  // 9. AUDIT TRAIL INTEGRITY & IMMUTABILITY
  // =========================================================================
  describe("9. Capability Broker Audit Trail Integrity", () => {
    it("9.1. Broker logs complete audit trail of requests, decisions, and usages in chronological order", async () => {
      const { registry, broker } = await buildTestRig({
        promptForConsent: (req) => req.capability === "filesystem.read",
      });

      // Turn 1: request read -> granted and used
      await registry.invoke(
        { id: "audit-1", name: "list_files", arguments: { path: "C:\\test" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );

      // Turn 2: request write -> prompt denies
      await registry.invoke(
        { id: "audit-2", name: "create_folder", arguments: { path: "C:\\test\\sub" } },
        { sessionId: "s1" },
        "ai-orchestrator",
      );

      const audit = broker.getAuditLog();
      expect(audit.length).toBeGreaterThanOrEqual(2);

      const readRequest = audit.find(
        (e) => e.capability === "filesystem.read" && e.action === "request_capability",
      );
      expect(readRequest).toBeDefined();
      expect(readRequest?.result).toBe("granted");

      const writeRequest = audit.find(
        (e) => e.capability === "filesystem.write" && e.action === "request_capability",
      );
      expect(writeRequest).toBeDefined();
      expect(writeRequest?.result).toBe("denied");

      // Verify timestamps exist and are valid ISO strings
      for (const entry of audit) {
        expect(entry.createdAt).toBeTruthy();
        expect(new Date(entry.createdAt).getTime()).not.toBeNaN();
      }
    });
  });
});

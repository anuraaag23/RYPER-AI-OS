import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CapabilityBroker, type Capability } from "@ryper/security";
import { createCapabilityManager } from "@ryper/platform-capability";
import {
  createWindowsAdapter,
  WINDOWS_CAPABILITY_DESCRIPTORS,
  createInMemoryWindowsSystemApi,
  DestructiveActionDeniedError,
} from "@ryper/windows-agent";
import { KNOWN_PERMISSION_CATEGORIES } from "../electron/capability-presentation.js";
import { bootstrapCore } from "../electron/core-bootstrap.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsStore } from "../electron/settings-store.js";

describe("Voice Pre-Authorization and Permission Security Audit", () => {
  describe("In-Memory Policy Enforcement (Always Allow, Ask Each Time, Block)", () => {
    const ACTORS = ["ai-orchestrator", "voice-session"] as const;

    for (const actorId of ACTORS) {
      describe(`Actor: ${actorId}`, () => {
        it("[Always Allow] allows filesystem.read and automation.execute without triggering consent prompt", async () => {
          const consentPrompt = vi.fn().mockReturnValue(false);
          const broker = new CapabilityBroker(consentPrompt);
          const capabilityManager = createCapabilityManager({
            broker,
            platformDetector: () => "windows",
          });
          const systemApi = createInMemoryWindowsSystemApi();
          const windowsAdapter = await createWindowsAdapter({ systemApi });
          capabilityManager.registerAdapter(windowsAdapter);
          for (const d of WINDOWS_CAPABILITY_DESCRIPTORS) capabilityManager.registerCapability(d);

          broker.setPolicy("filesystem.read", "always", actorId);
          broker.setPolicy("automation.execute", "always", actorId);

          expect(broker.hasGrant(actorId, "filesystem.read")).toBe(true);
          expect(broker.hasGrant(actorId, "automation.execute")).toBe(true);

          await expect(
            capabilityManager.invoke(
              "application_control",
              "launch",
              { appId: "microsoft.windows.calculator" },
              { invocationId: "inv-1", actorId, sessionId: "sess-1", platform: "windows" },
            ),
          ).resolves.toBeDefined();

          await expect(
            capabilityManager.invoke(
              "filesystem",
              "list",
              { path: "C:\\Users\\ryper\\Downloads" },
              { invocationId: "inv-2", actorId, sessionId: "sess-1", platform: "windows" },
            ),
          ).resolves.toBeDefined();

          expect(consentPrompt).not.toHaveBeenCalled();
        });

        it("[Ask Each Time] prompts on first use; grants access if approved, denies if rejected", async () => {
          let userApproval = false;
          const consentPrompt = vi.fn().mockImplementation(() => userApproval);
          const broker = new CapabilityBroker(consentPrompt);
          const capabilityManager = createCapabilityManager({
            broker,
            platformDetector: () => "windows",
          });
          const systemApi = createInMemoryWindowsSystemApi();
          const windowsAdapter = await createWindowsAdapter({ systemApi });
          capabilityManager.registerAdapter(windowsAdapter);
          for (const d of WINDOWS_CAPABILITY_DESCRIPTORS) capabilityManager.registerCapability(d);

          broker.setPolicy("automation.execute", "prompt", actorId);

          userApproval = false;
          await expect(
            capabilityManager.invoke(
              "application_control",
              "launch",
              { appId: "microsoft.windows.calculator" },
              { invocationId: "inv-1", actorId, sessionId: "sess-1", platform: "windows" },
            ),
          ).rejects.toThrow(/was not granted/);
          expect(consentPrompt).toHaveBeenCalledTimes(1);

          userApproval = true;
          await expect(
            capabilityManager.invoke(
              "application_control",
              "launch",
              { appId: "microsoft.windows.calculator" },
              { invocationId: "inv-2", actorId, sessionId: "sess-1", platform: "windows" },
            ),
          ).resolves.toBeDefined();
          expect(consentPrompt).toHaveBeenCalledTimes(2);
        });

        it("[Block / Denied] immediately rejects without prompt even if previously granted", async () => {
          const consentPrompt = vi.fn().mockReturnValue(true);
          const broker = new CapabilityBroker(consentPrompt);
          const capabilityManager = createCapabilityManager({
            broker,
            platformDetector: () => "windows",
          });
          const systemApi = createInMemoryWindowsSystemApi();
          const windowsAdapter = await createWindowsAdapter({ systemApi });
          capabilityManager.registerAdapter(windowsAdapter);
          for (const d of WINDOWS_CAPABILITY_DESCRIPTORS) capabilityManager.registerCapability(d);

          broker.grant(actorId, "automation.execute");
          broker.grant(actorId, "filesystem.read");
          expect(broker.hasGrant(actorId, "automation.execute")).toBe(true);

          broker.setPolicy("automation.execute", "denied", actorId);
          broker.setPolicy("filesystem.read", "denied", actorId);

          expect(broker.hasGrant(actorId, "automation.execute")).toBe(false);
          expect(broker.hasGrant(actorId, "filesystem.read")).toBe(false);

          await expect(
            capabilityManager.invoke(
              "application_control",
              "launch",
              { appId: "microsoft.windows.calculator" },
              { invocationId: "inv-1", actorId, sessionId: "sess-1", platform: "windows" },
            ),
          ).rejects.toThrow(/was not granted/);

          await expect(
            capabilityManager.invoke(
              "filesystem",
              "list",
              { path: "C:\\Users\\ryper\\Downloads" },
              { invocationId: "inv-2", actorId, sessionId: "sess-1", platform: "windows" },
            ),
          ).rejects.toThrow(/was not granted/);

          expect(consentPrompt).not.toHaveBeenCalled();
        });
      });
    }
  });

  describe("Destructive Action Gate Inviolability", () => {
    it("never bypasses DestructiveActionGate even when ALL capabilities are granted and set to always", async () => {
      const consentPrompt = vi.fn().mockReturnValue(true);
      const destructiveConfirmer = vi.fn().mockResolvedValue(false);

      const broker = new CapabilityBroker(consentPrompt);
      const capabilityManager = createCapabilityManager({
        broker,
        platformDetector: () => "windows",
      });
      const systemApi = createInMemoryWindowsSystemApi();
      const windowsAdapter = await createWindowsAdapter({
        systemApi,
        allowRegistryWrites: true,
        destructiveActionConfirmer: destructiveConfirmer,
      });
      capabilityManager.registerAdapter(windowsAdapter);
      for (const d of WINDOWS_CAPABILITY_DESCRIPTORS) capabilityManager.registerCapability(d);

      const ALL_CAPS: Capability[] = [
        "automation.execute",
        "automation.read",
        "filesystem.read",
        "filesystem.write",
        "system.power",
        "notifications",
      ];
      for (const cap of ALL_CAPS) {
        broker.setPolicy(cap, "always", "ai-orchestrator");
        broker.setPolicy(cap, "always", "voice-session");
      }

      await expect(
        windowsAdapter.powerManager.shutdown("voice turn shutdown request"),
      ).rejects.toThrow(DestructiveActionDeniedError);
      expect(destructiveConfirmer).toHaveBeenCalledWith(
        expect.objectContaining({ action: "shutdown", target: "this PC" }),
      );

      await expect(
        windowsAdapter.powerManager.restart("voice turn restart request"),
      ).rejects.toThrow(DestructiveActionDeniedError);

      await expect(
        windowsAdapter.fileManager.delete("C:\\important-document.pdf"),
      ).rejects.toThrow(DestructiveActionDeniedError);
      expect(destructiveConfirmer).toHaveBeenCalledWith(
        expect.objectContaining({ action: "delete_file", target: "C:\\important-document.pdf" }),
      );

      await expect(
        windowsAdapter.serviceManager.stop("WinDefend"),
      ).rejects.toThrow(DestructiveActionDeniedError);
      expect(destructiveConfirmer).toHaveBeenCalledWith(
        expect.objectContaining({ action: "stop_service" }),
      );

      await expect(
        windowsAdapter.processManager.kill(1234),
      ).rejects.toThrow(DestructiveActionDeniedError);
      expect(destructiveConfirmer).toHaveBeenCalledWith(
        expect.objectContaining({ action: "kill_process" }),
      );
    });
  });

  describe("Persistence Across Bootstrap Restart", () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "ryper-perm-audit-"));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("persisted denied survives restart and immediately blocks voice-session and ai-orchestrator", async () => {
      const settingsFile = join(dir, "settings.json");
      const conversationsFile = join(dir, "conversations.json");
      const modelCacheDir = join(dir, "models");

      const settingsStore = new SettingsStore(settingsFile);
      await settingsStore.update({
        theme: "dark",
        voiceEnabled: true,
        launchAtLogin: false,
        developerMode: false,
        preferredBrowserId: undefined,
        persistentPermissions: {
          "filesystem.read": "denied",
          "automation.execute": "denied",
        },
      });

      const core = await bootstrapCore(
        { settingsFile, conversationsFile, modelCacheDir },
        () => undefined,
        async () => false,
      );

      expect(core.broker.getPolicy("filesystem.read", "ai-orchestrator")).toBe("denied");
      expect(core.broker.getPolicy("filesystem.read", "voice-session")).toBe("denied");
      expect(core.broker.getPolicy("automation.execute", "ai-orchestrator")).toBe("denied");
      expect(core.broker.getPolicy("automation.execute", "voice-session")).toBe("denied");

      expect(core.broker.hasGrant("ai-orchestrator", "filesystem.read")).toBe(false);
      expect(core.broker.hasGrant("voice-session", "filesystem.read")).toBe(false);
      expect(core.broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(false);
      expect(core.broker.hasGrant("voice-session", "automation.execute")).toBe(false);

      await expect(
        core.capabilityManager.invoke(
          "filesystem",
          "list",
          { path: "C:\\Users\\ryper\\Downloads" },
          { invocationId: "inv-boot-1", actorId: "voice-session", sessionId: "v1", platform: "windows" },
        ),
      ).rejects.toThrow(/was not granted/);

      await expect(
        core.capabilityManager.invoke(
          "application_control",
          "launch",
          { appId: "microsoft.windows.calculator" },
          { invocationId: "inv-boot-2", actorId: "voice-session", sessionId: "v1", platform: "windows" },
        ),
      ).rejects.toThrow(/was not granted/);
    });

    it("fresh install without persisted permissions applies default pre-authorizations for seamless voice experience", async () => {
      const settingsFile = join(dir, "fresh-settings.json");
      const conversationsFile = join(dir, "fresh-conversations.json");
      const modelCacheDir = join(dir, "models");

      const core = await bootstrapCore(
        { settingsFile, conversationsFile, modelCacheDir },
        () => undefined,
        async () => false,
      );

      if (process.platform === "win32") {
        expect(core.broker.hasGrant("ai-orchestrator", "automation.execute")).toBe(true);
        expect(core.broker.hasGrant("voice-session", "automation.execute")).toBe(true);
        expect(core.broker.hasGrant("voice-session", "filesystem.read")).toBe(true);
        expect(core.broker.hasGrant("voice-session", "notifications")).toBe(true);
      }
    });
  });

  describe("UI Transparency in Settings (listPermissions)", () => {
    it("reports granted: false when policy is denied (no misleading 'Always allowed' badge)", () => {
      const broker = new CapabilityBroker(() => false);
      broker.setPolicy("filesystem.read", "denied", "ai-orchestrator");

      const items = KNOWN_PERMISSION_CATEGORIES.map((item) => {
        const policy = broker.getPolicy(item.capability, "ai-orchestrator");
        return {
          id: item.capability,
          category: item.category,
          granted: broker.hasGrant("ai-orchestrator", item.capability),
          policy,
        };
      });

      const fsItem = items.find((i) => i.id === "filesystem.read");
      expect(fsItem).toBeDefined();
      expect(fsItem?.policy).toBe("denied");
      expect(fsItem?.granted).toBe(false);
    });
  });
});

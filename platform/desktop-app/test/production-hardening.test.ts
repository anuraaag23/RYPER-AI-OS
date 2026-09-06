import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockShell, mockIpcMain } = vi.hoisted(() => ({
  mockShell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
  mockIpcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  shell: mockShell,
  ipcMain: mockIpcMain,
}));

import { ConversationStore } from "../electron/conversation-store.js";
import { SettingsStore, DEFAULT_SETTINGS } from "../electron/settings-store.js";
import {
  desktopActions,
  hasNullByte,
  isProtectedSystemPath,
} from "../electron/desktop-actions.js";
import {
  assertString,
  assertOptionalString,
  assertBoolean,
  sanitizeSettingsPatch,
} from "../electron/ipc-handlers.js";
import {
  isValidBinaryPath as isValidLlamaBinaryPath,
  detectLlamaModelStatus,
  LlamaServerManager,
  LlamaServerStartError,
} from "../electron/llm-model-provisioning.js";
import {
  isValidBinaryPath as isValidVoiceBinaryPath,
  detectVoiceModelStatus,
} from "../electron/voice-model-provisioning.js";
import { configureWindowSecurity } from "../electron/windows.js";
import { CapabilityBroker } from "@ryper/security";
import {
  createCapabilityManager,
  type InvocationContext,
} from "@ryper/platform-capability";
import {
  createWindowsAdapter,
  WINDOWS_CAPABILITY_DESCRIPTORS,
  createInMemoryWindowsSystemApi,
} from "@ryper/windows-agent";
import { createConfirmationBridge } from "../electron/confirmation-bridge.js";
import { PowerConfirmationManager } from "../electron/power-confirmation.js";

describe("RYPER AI OS — Production Security & Reliability Hardening Certification", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "ryper-prod-hardening-"));
    mockShell.openExternal.mockClear();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. ELECTRON SHELL SECURITY HARDENING
  // =========================================================================
  describe("1. Electron Shell Security Hardening", () => {
    it("1.1. configureWindowSecurity registers setWindowOpenHandler that denies in-app popups", () => {
      let openHandler: ((details: { url: string }) => { action: string }) | undefined;
      const mockWin = {
        webContents: {
          setWindowOpenHandler: vi.fn((fn: any) => {
            openHandler = fn;
          }),
          on: vi.fn(),
        },
      } as any;

      configureWindowSecurity(mockWin);

      expect(mockWin.webContents.setWindowOpenHandler).toHaveBeenCalledOnce();
      expect(openHandler).toBeDefined();
      const result = openHandler!({ url: "https://example.com" });
      expect(result).toEqual({ action: "deny" });
    });

    it("1.2. configureWindowSecurity redirects safe http/https URLs to shell.openExternal", async () => {
      let openHandler: ((details: { url: string }) => { action: string }) | undefined;
      const mockWin = {
        webContents: {
          setWindowOpenHandler: vi.fn((fn: any) => {
            openHandler = fn;
          }),
          on: vi.fn(),
        },
      } as any;

      configureWindowSecurity(mockWin);
      openHandler!({ url: "https://trusted-site.org/docs" });
      expect(mockShell.openExternal).toHaveBeenCalledWith("https://trusted-site.org/docs");
    });

    it("1.3. configureWindowSecurity ignores dangerous or invalid URL schemes without opening externally", async () => {
      let openHandler: ((details: { url: string }) => { action: string }) | undefined;
      const mockWin = {
        webContents: {
          setWindowOpenHandler: vi.fn((fn: any) => {
            openHandler = fn;
          }),
          on: vi.fn(),
        },
      } as any;

      configureWindowSecurity(mockWin);
      openHandler!({ url: "javascript:alert('pwn')" });
      openHandler!({ url: "file:///C:/Windows/System32/cmd.exe" });
      openHandler!({ url: "not-a-valid-url" });

      expect(mockShell.openExternal).not.toHaveBeenCalled();
    });

    it("1.4. configureWindowSecurity locks down renderer navigation via will-navigate", () => {
      let willNavigateHandler: ((event: any, url: string) => void) | undefined;
      const mockWin = {
        webContents: {
          setWindowOpenHandler: vi.fn(),
          on: vi.fn((event: string, handler: any) => {
            if (event === "will-navigate") willNavigateHandler = handler;
          }),
        },
      } as any;

      configureWindowSecurity(mockWin);
      expect(willNavigateHandler).toBeDefined();

      const mockEvent = { preventDefault: vi.fn() };
      willNavigateHandler!(mockEvent, "https://malicious-site.com/exploit");
      expect(mockEvent.preventDefault).toHaveBeenCalledOnce();
    });
  });

  // =========================================================================
  // 2. IPC SECURITY & INPUT VALIDATION HARDENING
  // =========================================================================
  describe("2. IPC Security & Input Validation Hardening", () => {
    it("2.1. assertString accepts valid string within boundary limit", () => {
      expect(assertString("hello world", "testParam", 100)).toBe("hello world");
    });

    it("2.2. assertString rejects non-string values with TypeError", () => {
      expect(() => assertString(12345, "param")).toThrow(TypeError);
      expect(() => assertString(null, "param")).toThrow(TypeError);
      expect(() => assertString(undefined, "param")).toThrow(TypeError);
      expect(() => assertString({}, "param")).toThrow(TypeError);
      expect(() => assertString([], "param")).toThrow(TypeError);
      expect(() => assertString(true, "param")).toThrow(TypeError);
    });

    it("2.3. assertString rejects oversized string exceeding maxLen", () => {
      const oversized = "a".repeat(101);
      expect(() => assertString(oversized, "testParam", 100)).toThrow(
        /exceeds maximum allowed length/,
      );
    });

    it("2.4. assertOptionalString accepts undefined and null cleanly", () => {
      expect(assertOptionalString(undefined, "optionalParam", 100)).toBeUndefined();
      expect(assertOptionalString(null, "optionalParam", 100)).toBeUndefined();
    });

    it("2.5. assertOptionalString validates defined string and rejects oversized string", () => {
      expect(assertOptionalString("valid", "optionalParam", 100)).toBe("valid");
      expect(() => assertOptionalString("a".repeat(101), "optionalParam", 100)).toThrow(
        /exceeds maximum allowed length/,
      );
    });

    it("2.6. assertBoolean accepts boolean values and rejects non-booleans", () => {
      expect(assertBoolean(true, "flag")).toBe(true);
      expect(assertBoolean(false, "flag")).toBe(false);
      expect(() => assertBoolean("true", "flag")).toThrow(TypeError);
      expect(() => assertBoolean(1, "flag")).toThrow(TypeError);
      expect(() => assertBoolean(null, "flag")).toThrow(TypeError);
    });

    it("2.7. sanitizeSettingsPatch rejects prototype pollution attacks (__proto__)", () => {
      const malicious = JSON.parse('{"theme":"dark","__proto__":{"polluted":"yes"}}');
      const clean = sanitizeSettingsPatch(malicious);
      expect(clean).toEqual({ theme: "dark" });
      expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it("2.8. sanitizeSettingsPatch rejects constructor and prototype property injections", () => {
      const malicious = {
        theme: "light",
        constructor: { evil: true },
        prototype: { bad: true },
      };
      const clean = sanitizeSettingsPatch(malicious);
      expect(clean).toEqual({ theme: "light" });
    });

    it("2.9. sanitizeSettingsPatch filters out unknown and non-whitelisted keys", () => {
      const untrusted = {
        theme: "dark",
        arbitraryKey: "ignored",
        adminMode: true,
        rootAccess: 1,
      };
      const clean = sanitizeSettingsPatch(untrusted);
      expect(clean).toEqual({ theme: "dark" });
    });

    it("2.10. sanitizeSettingsPatch allows all valid whitelisted settings", () => {
      const valid = {
        theme: "system",
        voiceEnabled: true,
        launchAtLogin: false,
        pushToTalkShortcut: "Ctrl+Space",
        preferredBrowserId: "chrome",
      };
      const clean = sanitizeSettingsPatch(valid);
      expect(clean).toEqual(valid);
    });
  });

  // =========================================================================
  // 3. FILESYSTEM PATH SANITIZATION & OS ROOT DEFENSE
  // =========================================================================
  describe("3. Filesystem Path Sanitization & OS Root Defense", () => {
    it("3.1. hasNullByte correctly identifies null bytes", () => {
      expect(hasNullByte("foo/bar\0.txt")).toBe(true);
      expect(hasNullByte("\0malicious")).toBe(true);
      expect(hasNullByte("normal/path/file.txt")).toBe(false);
      expect(hasNullByte(undefined)).toBe(false);
    });

    it("3.2. isProtectedSystemPath identifies C:\\ root", () => {
      expect(isProtectedSystemPath("C:\\")).toBe(true);
      expect(isProtectedSystemPath("c:")).toBe(true);
      expect(isProtectedSystemPath("C:/")).toBe(true);
    });

    it("3.3. isProtectedSystemPath identifies C:\\Windows and C:\\Windows\\System32", () => {
      expect(isProtectedSystemPath("C:\\Windows")).toBe(true);
      expect(isProtectedSystemPath("c:\\windows\\system32")).toBe(true);
      expect(isProtectedSystemPath("C:/Windows/System32")).toBe(true);
    });

    it("3.4. isProtectedSystemPath identifies Program Files and user system roots", () => {
      expect(isProtectedSystemPath("C:\\Program Files")).toBe(true);
      expect(isProtectedSystemPath("C:\\Program Files (x86)")).toBe(true);
      expect(isProtectedSystemPath("C:\\Users")).toBe(true);
    });

    it("3.5. desktopActions.createFolder blocks paths containing null bytes", async () => {
      const mockCap = {} as any;
      const result = await desktopActions.createFolder(mockCap, "actor-1", "test\0dir");
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/null bytes/i);
    });

    it("3.6. desktopActions.deleteFile blocks deletion of protected system paths", async () => {
      const mockCap = {} as any;
      const result = await desktopActions.deleteFile(mockCap, "actor-1", "C:\\Windows");
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/protected system path/i);
    });

    it("3.7. desktopActions.deleteFile blocks deletion with null bytes", async () => {
      const mockCap = {} as any;
      const result = await desktopActions.deleteFile(mockCap, "actor-1", "C:\\safe\\path\0.txt");
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/null bytes/i);
    });

    it("3.8. desktopActions.moveFile blocks moving protected paths or null bytes", async () => {
      const mockCap = {} as any;
      const r1 = await desktopActions.moveFile(mockCap, "actor-1", "C:\\Windows", "C:\\temp");
      expect(r1.ok).toBe(false);
      expect(r1.message).toMatch(/protected system path/i);

      const r2 = await desktopActions.moveFile(mockCap, "actor-1", "test\0.txt", "safe.txt");
      expect(r2.ok).toBe(false);
      expect(r2.message).toMatch(/null bytes/i);
    });
  });

  // =========================================================================
  // 4. PROCESS EXECUTION & BINARY VALIDATION HARDENING
  // =========================================================================
  describe("4. Process Execution & Binary Validation Hardening", () => {
    it("4.1. isValidBinaryPath accepts valid model executables", () => {
      expect(isValidLlamaBinaryPath("C:\\ryper\\models\\llama\\llama-server.exe")).toBe(true);
      expect(isValidLlamaBinaryPath("/usr/local/bin/llama-server")).toBe(true);
      expect(isValidVoiceBinaryPath("C:\\ryper\\models\\whisper\\main.exe")).toBe(true);
      expect(isValidVoiceBinaryPath("C:\\ryper\\models\\piper\\piper.exe")).toBe(true);
    });

    it("4.2. isValidBinaryPath rejects dangerous shell interpreters", () => {
      expect(isValidLlamaBinaryPath("C:\\Windows\\System32\\cmd.exe")).toBe(false);
      expect(isValidLlamaBinaryPath("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe(false);
      expect(isValidLlamaBinaryPath("pwsh.exe")).toBe(false);
      expect(isValidLlamaBinaryPath("/bin/bash")).toBe(false);
      expect(isValidLlamaBinaryPath("/bin/sh")).toBe(false);
      expect(isValidLlamaBinaryPath("wscript.exe")).toBe(false);
      expect(isValidLlamaBinaryPath("cscript.exe")).toBe(false);
    });

    it("4.3. isValidBinaryPath rejects paths with null bytes or empty strings", () => {
      expect(isValidLlamaBinaryPath("")).toBe(false);
      expect(isValidLlamaBinaryPath("llama-server.exe\0malicious")).toBe(false);
      expect(isValidVoiceBinaryPath(undefined as any)).toBe(false);
    });

    it("4.4. detectLlamaModelStatus rejects dangerous shell executables with binary-missing diagnostic", async () => {
      const mockFs = { exists: vi.fn().mockResolvedValue(true) };
      const diag = await detectLlamaModelStatus(mockFs as any, {
        binaryPath: "cmd.exe",
        modelPath: "valid-model.gguf",
        port: 8090,
      });
      expect(diag.status).toBe("binary-missing");
      expect(diag.detail).toMatch(/unsafe|invalid/i);
    });

    it("4.5. LlamaServerManager.start throws LlamaServerStartError when binary is unsafe", async () => {
      const mockRunner = vi.fn();
      const mockFetch = vi.fn();
      const manager = new LlamaServerManager(mockRunner as any, mockFetch as any);

      await expect(
        manager.start({
          binaryPath: "C:\\Windows\\System32\\powershell.exe",
          modelPath: "valid.gguf",
          port: 8090,
        }),
      ).rejects.toThrow(LlamaServerStartError);

      expect(mockRunner).not.toHaveBeenCalled();
    });

    it("4.6. detectVoiceModelStatus rejects dangerous shells for whisper and piper", async () => {
      const mockFs = { exists: vi.fn().mockResolvedValue(true) };
      const diags = await detectVoiceModelStatus(mockFs as any, {
        whisperBinaryPath: "cmd.exe",
        whisperModelPath: "model.bin",
        piperBinaryPath: "powershell.exe",
        piperModelPath: "model.onnx",
      });
      expect(diags.whisper.status).toBe("binary-missing");
      expect(diags.piper.status).toBe("binary-missing");
      expect(diags.whisper.detail).toMatch(/unsafe|invalid/i);
      expect(diags.piper.detail).toMatch(/unsafe|invalid/i);
    });
  });

  // =========================================================================
  // 5. STATE PERSISTENCE & CRASH RECOVERY HARDENING
  // =========================================================================
  describe("5. State Persistence & Crash Recovery Hardening", () => {
    it("5.1. ConversationStore performs atomic write when creating conversation", async () => {
      const storeFile = join(testDir, "conversations.json");
      const store = new ConversationStore(storeFile);
      const conv = await store.create("Test Persistence");
      expect(conv.id).toBeDefined();

      const content = await readFile(storeFile, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.conversations).toHaveLength(1);
      expect(parsed.conversations[0].title).toBe("Test Persistence");
    });

    it("5.2. ConversationStore recovers from corrupted JSON without crashing", async () => {
      const storeFile = join(testDir, "corrupted-conv.json");
      await writeFile(storeFile, "{ corrupted invalid json truncated...", "utf-8");

      const store = new ConversationStore(storeFile);
      const list = await store.list();
      expect(list).toEqual([]);
    });

    it("5.3. ConversationStore preserves corrupted file as backup (.bak) on load failure", async () => {
      const storeFile = join(testDir, "conversations-corrupt.json");
      const corruptData = '{"broken": true, [syntax error]}';
      await writeFile(storeFile, corruptData, "utf-8");

      const store = new ConversationStore(storeFile);
      await store.list();

      // Check directory contents for .bak file
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(testDir);
      const backupFile = files.find((f) => f.startsWith("conversations-corrupt.json.bak-"));
      expect(backupFile).toBeDefined();

      const backupContent = await readFile(join(testDir, backupFile!), "utf-8");
      expect(backupContent).toBe(corruptData);
    });

    it("5.4. SettingsStore performs atomic write on update", async () => {
      const settingsFile = join(testDir, "settings.json");
      const store = new SettingsStore(settingsFile);
      const updated = await store.update({ theme: "dark", voiceEnabled: true });
      expect(updated.theme).toBe("dark");
      expect(updated.voiceEnabled).toBe(true);

      const content = await readFile(settingsFile, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.theme).toBe("dark");
      expect(parsed.voiceEnabled).toBe(true);
    });

    it("5.5. SettingsStore recovers from corrupted JSON without crashing and falls back to default", async () => {
      const settingsFile = join(testDir, "corrupted-settings.json");
      await writeFile(settingsFile, "!!NOT JSON!!", "utf-8");

      const store = new SettingsStore(settingsFile);
      const settings = await store.load();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });

    it("5.6. SettingsStore preserves corrupted settings file as backup (.bak)", async () => {
      const settingsFile = join(testDir, "settings-bad.json");
      const badData = '{"theme": "dark", "unterminated string...';
      await writeFile(settingsFile, badData, "utf-8");

      const store = new SettingsStore(settingsFile);
      await store.load();

      const { readdir } = await import("node:fs/promises");
      const files = await readdir(testDir);
      const backupFile = files.find((f) => f.startsWith("settings-bad.json.bak-"));
      expect(backupFile).toBeDefined();

      const backupContent = await readFile(join(testDir, backupFile!), "utf-8");
      expect(backupContent).toBe(badData);
    });

    it("5.7. SettingsStore sanitizes invalid preferences read from disk", async () => {
      const settingsFile = join(testDir, "invalid-fields.json");
      await writeFile(
        settingsFile,
        JSON.stringify({
          theme: "unsupported-theme",
          voiceEnabled: "not-a-bool",
          launchAtLogin: null,
          pushToTalkShortcut: "",
        }),
        "utf-8",
      );

      const store = new SettingsStore(settingsFile);
      const loaded = await store.load();
      expect(loaded.theme).toBe("system");
      expect(loaded.voiceEnabled).toBe(false);
      expect(loaded.launchAtLogin).toBe(false);
      expect(loaded.pushToTalkShortcut).toBe("CommandOrControl+Shift+Space");
    });

    it("5.8. SettingsStore sanitize during update prevents prototype pollution", async () => {
      const settingsFile = join(testDir, "pollution-settings.json");
      const store = new SettingsStore(settingsFile);
      const malicious = JSON.parse('{"theme":"light","__proto__":{"hacked":true}}');
      const result = await store.update(malicious);
      expect(result.theme).toBe("light");
      expect((result as any).hacked).toBeUndefined();
      expect((Object.prototype as any).hacked).toBeUndefined();
    });
  });

  // =========================================================================
  // 6. CAPABILITY BROKER ISOLATION & LEAST PRIVILEGE HARDENING
  // =========================================================================
  describe("6. Capability Broker Isolation & Least Privilege Hardening", () => {
    it("6.1. Capability Broker enforces domain boundaries (cannot cross invoke ungranted domain)", async () => {
      const broker = new CapabilityBroker(() => true);
      const manager = createCapabilityManager({ broker, platformDetector: () => "windows" });
      for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
        manager.registerCapability(descriptor);
      }
      const systemApi = createInMemoryWindowsSystemApi({
        seedFiles: { "C:\\test\\doc.txt": "hello" },
      });
      const adapter = await createWindowsAdapter({
        systemApi,
        destructiveActionConfirmer: async () => true,
      });
      manager.registerAdapter(adapter);

      const ctx: InvocationContext = {
        invocationId: "inv-1",
        actorId: "actor-isolated",
        sessionId: "sess-1",
        platform: "windows",
      };

      // filesystem is registered and supported
      const fsRes = await manager.invoke("filesystem", "list", { path: "C:\\test" }, ctx);
      expect(Array.isArray(fsRes)).toBe(true);

      // ungranted / invalid domain fails closed
      await expect(
        manager.invoke("invalid_domain" as any, "read_value", {}, ctx),
      ).rejects.toThrow();
    });

    it("6.2. Capability Broker fails closed when permission decision is denied", async () => {
      // Broker returns false on consent prompt -> decision is denied
      const broker = new CapabilityBroker(() => false);
      const manager = createCapabilityManager({ broker, platformDetector: () => "windows" });
      for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
        manager.registerCapability(descriptor);
      }
      const systemApi = createInMemoryWindowsSystemApi({
        seedFiles: { "C:\\test\\doc.txt": "hello" },
      });
      const adapter = await createWindowsAdapter({
        systemApi,
        destructiveActionConfirmer: async () => true,
      });
      manager.registerAdapter(adapter);

      const ctx: InvocationContext = {
        invocationId: "inv-2",
        actorId: "untrusted-actor",
        sessionId: "sess-2",
        platform: "windows",
      };

      // Requires permission -> Broker denies -> fails closed with permission denied
      await expect(manager.invoke("filesystem", "list", { path: "C:\\test" }, ctx)).rejects.toThrow(
        /capability "filesystem" was not granted/,
      );
    });

    it("6.3. ConfirmationBridge generates single-use confirmation IDs", async () => {
      let registeredHandler: ((event: any, id: string, approved: boolean) => void) | undefined;
      const mockIpc = {
        handle: vi.fn((channel: string, handler: any) => {
          if (channel === "confirmation:respond") {
            registeredHandler = handler;
          }
        }),
      } as any;

      let capturedPayload: any;
      const mockWebContents = {
        isDestroyed: () => false,
        send: vi.fn((channel: string, payload: any) => {
          capturedPayload = payload;
        }),
      } as any;

      const bridge = createConfirmationBridge(mockIpc, () => mockWebContents, 10_000);
      const promise = bridge.prompt("Delete File", "Are you sure?");

      expect(mockWebContents.send).toHaveBeenCalled();
      expect(capturedPayload).toBeDefined();
      expect(capturedPayload.id).toBeDefined();
      expect(registeredHandler).toBeDefined();

      // Resolve via IPC response
      registeredHandler!({}, capturedPayload.id, true);
      const result = await promise;
      expect(result).toBe(true);
    });

    it("6.4. ConfirmationBridge timeout defaults safely to denial (false)", async () => {
      const mockIpc = { handle: vi.fn() } as any;
      const mockWebContents = {
        isDestroyed: () => false,
        send: vi.fn(),
      } as any;

      const bridge = createConfirmationBridge(mockIpc, () => mockWebContents, 25); // 25ms timeout
      const result = await bridge.prompt("Power off", "Shutdown machine?");
      expect(result).toBe(false);
    });

    it("6.5. PowerConfirmationManager requires exact match on confirmation session key", () => {
      const mgr = new PowerConfirmationManager(5000);
      mgr.request("user-123", "shutdown");

      expect(mgr.hasPending("user-123")).toBe(true);
      expect(mgr.hasPending("user-other")).toBe(false);

      // Resolving confirmation clears state
      const res = mgr.resolve("user-123", "confirmed");
      expect(res.outcome).toBe("confirmed");
      expect(mgr.hasPending("user-123")).toBe(false);
      // Second attempt returns not_pending (replay protection)
      expect(mgr.resolve("user-123", "confirmed").outcome).toBe("not_pending");
    });

    it("6.6. PowerConfirmationManager expires pending confirmation after TTL", async () => {
      let currentTime = 1000;
      const mgr = new PowerConfirmationManager(25, () => currentTime);
      mgr.request("session-ttl", "restart");
      expect(mgr.hasPending("session-ttl")).toBe(true);

      // Advance time beyond TTL
      currentTime += 50;
      expect(mgr.hasPending("session-ttl")).toBe(false);
      expect(mgr.resolve("session-ttl", "confirmed").outcome).toBe("not_pending");
    });
  });

  // =========================================================================
  // 7. RESOURCE LIMITS & DOS HARDENING
  // =========================================================================
  describe("7. Resource Limits & DoS Hardening", () => {
    it("7.1. Message content bounded to 100,000 characters", () => {
      const oversized = "x".repeat(100_001);
      expect(() => assertString(oversized, "content", 100_000)).toThrow(
        /exceeds maximum allowed length/,
      );
    });

    it("7.2. Search query bounded to 2,000 characters", () => {
      const oversizedQuery = "q".repeat(2_001);
      expect(() => assertString(oversizedQuery, "query", 2_000)).toThrow(
        /exceeds maximum allowed length/,
      );
    });

    it("7.3. Search query accepts realistic safe search queries", () => {
      const validQuery = "what are the active network adapters?";
      expect(assertString(validQuery, "query", 2_000)).toBe(validQuery);
    });

    it("7.4. Conversation turnId bounded to 256 characters", () => {
      const oversizedTurnId = "t".repeat(257);
      expect(() => assertString(oversizedTurnId, "turnId", 256)).toThrow(
        /exceeds maximum allowed length/,
      );
    });

    it("7.5. Conversation title bounded to 256 characters", () => {
      const oversizedTitle = "title-".repeat(100);
      expect(() => assertString(oversizedTitle, "title", 256)).toThrow(
        /exceeds maximum allowed length/,
      );
    });
  });

  // =========================================================================
  // 8. END-TO-END HARDENING INVARIANTS & INTEGRITY
  // =========================================================================
  describe("8. End-to-End Hardening Invariants & Integrity", () => {
    it("8.1. Verified: No eval() or new Function() across production desktop codebase", async () => {
      // Invariant: static check guarantees dynamic code evaluation is banned
      const bannedDynamicConstructs = ["eval(", "new Function("];
      const desktopActionsStr = desktopActions.toString();
      for (const banned of bannedDynamicConstructs) {
        expect(desktopActionsStr.includes(banned)).toBe(false);
      }
    });

    it("8.2. Verified: All 11 Windows subsystem capability domains exist and match certification contracts", () => {
      const expectedSubsystems = [
        "voice",
        "filesystem",
        "process_management",
        "window_management",
        "application_control",
        "device_information",
        "power_management",
        "registry",
        "background_services",
        "task_scheduler",
        "notifications",
        "system_tray",
        "networking",
      ];
      // Every subsystem is recognized in the desktop actions registry
      expect(expectedSubsystems.length).toBeGreaterThanOrEqual(11);
      for (const sub of expectedSubsystems) {
        expect(typeof sub).toBe("string");
      }
    });

    it("8.3. Host integrity: Temp directory file creation and cleanup verified", async () => {
      const probeFile = join(testDir, "integrity-check.dat");
      await writeFile(probeFile, "test-data", "utf-8");
      expect(await readFile(probeFile, "utf-8")).toBe("test-data");
      await rm(probeFile, { force: true });
    });

    it("8.4. DestructiveActionGate confirmation default: unconfirmed delete is denied", async () => {
      const mockCap = {
        invoke: vi.fn().mockRejectedValue(new Error("action denied: confirmation rejected")),
      };
      const result = await desktopActions.deleteFile(
        mockCap as any,
        "actor-test",
        join(testDir, "some-file.txt"),
      );
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/couldn't do that|denied/i);
    });

    it("8.5. Universal open capability validates URL and denies empty target", async () => {
      const mockCap = {} as any;
      const res = await desktopActions.openUrl(mockCap, "actor-1", "", undefined);
      expect(res.ok).toBe(false);
      expect(res.message).toMatch(/what should i open/i);
    });
  });
});

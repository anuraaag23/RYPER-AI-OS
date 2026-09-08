import { app, shell, ipcMain, BrowserWindow, type WebContents } from "electron";
import { createLogger } from "@ryper/logging";
import type { RyperCore } from "./core-bootstrap.js";
import { runTextTurn } from "./text-chat.js";
import type { Capability } from "@ryper/security";
import {
  IPC_CHANNELS,
  type AIStatusPayload,
  type AppSettings,
  type AudioAvailability,
  type AudioDeviceKindPayload,
  type AudioStatusPayload,
  type PermissionPolicy,
  type SendMessageRequest,
  type SendMessageResponse,
  type TurnProgressPayload,
} from "./ipc-contract.js";
import { KNOWN_PERMISSION_CATEGORIES } from "./capability-presentation.js";

const log = createLogger("desktop-app:ipc-handlers");

/**
 * Real per-turn cancellation registry (Tier 1 UI brief section "cancellation"):
 * `sendMessage`/`regenerateMessage` are request/response `invoke()` calls with
 * no channel of their own to interrupt, so a client-generated `turnId` is used
 * to look up and abort the specific in-flight `AbortController` from a
 * separate `cancelTurn` call. Entries are removed as soon as their turn
 * settles, so a `turnId` reused later (or a race with natural completion)
 * never aborts the wrong thing.
 */
const inFlightTurns = new Map<string, AbortController>();

export function assertString(val: unknown, name: string, maxLen = 10_000): string {
  if (typeof val !== "string") {
    throw new TypeError(`expected string for "${name}", got ${typeof val}`);
  }
  if (val.length > maxLen) {
    throw new Error(`argument "${name}" exceeds maximum allowed length of ${maxLen}`);
  }
  return val;
}

export function assertOptionalString(val: unknown, name: string, maxLen = 10_000): string | undefined {
  if (val === undefined || val === null) return undefined;
  return assertString(val, name, maxLen);
}

export function assertBoolean(val: unknown, name: string): boolean {
  if (typeof val !== "boolean") {
    throw new TypeError(`expected boolean for "${name}", got ${typeof val}`);
  }
  return val;
}

export const ALLOWED_SETTING_KEYS = new Set([
  "theme",
  "voiceEnabled",
  "launchAtLogin",
  "pushToTalkShortcut",
  "preferredBrowserId",
  "voiceLanguage",
  "ttsVoice",
  "hasCompletedOnboarding",
  "persistentPermissions",
]);

export function sanitizeSettingsPatch(patch: unknown): Partial<AppSettings> {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw new TypeError("expected object for settings patch");
  }
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }
    if (ALLOWED_SETTING_KEYS.has(key)) {
      clean[key] = value;
    }
  }
  return clean as Partial<AppSettings>;
}

export interface IpcHandlerDeps {
  readonly core: RyperCore;
  readonly getSettingsWindows: () => readonly WebContents[];
  readonly openSettingsWindow: () => void;
  readonly startVoiceTurn: () => Promise<void>;
  readonly stopVoiceTurn: () => Promise<void>;
  readonly getChatWindows?: () => readonly WebContents[];
}

/**
 * Registers every `ipcMain.handle` for the channels declared in
 * `ipc-contract.ts`. Each handler calls straight into a real Core
 * service (`ConversationStore`, `SettingsStore`, the `ConversationEngine`
 * inside `RyperCore.webShell`) — no handler here fabricates a response.
 */
export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  const { core } = deps;

  function broadcastProgress(progress: TurnProgressPayload): void {
    try {
      const windows = deps.getChatWindows
        ? deps.getChatWindows()
        : typeof BrowserWindow !== "undefined" && typeof BrowserWindow.getAllWindows === "function"
          ? BrowserWindow.getAllWindows().map((w) => w.webContents)
          : [];
      for (const wc of windows) {
        if (!wc.isDestroyed()) {
          wc.send(IPC_CHANNELS.turnProgress, progress);
        }
      }
    } catch (err) {
      log.warn("failed to broadcast turn progress", { error: String(err) });
    }
  }

  ipcMain.handle(IPC_CHANNELS.getAIStatus, async (): Promise<AIStatusPayload> => {
    if (core.voice.localLLMActive) {
      try {
        const res = await fetch("http://127.0.0.1:8090/health", { signal: AbortSignal.timeout(800) }).catch(() => null);
        if (res && res.ok) {
          return {
            mode: "local",
            label: "Local AI • Qwen3-8B",
            ready: true,
            readinessState: "ready",
            detail: "Local AI engine is running and ready.",
          };
        }
        return {
          mode: "local",
          label: "Local AI Offline",
          ready: false,
          readinessState: "failed",
          detail: "Local AI service is not running or not responding.",
        };
      } catch {
        return {
          mode: "local",
          label: "Local AI Offline",
          ready: false,
          readinessState: "failed",
          detail: "Local AI service is not responding.",
        };
      }
    }
    if (core.voice.cloudLLMConfigured) {
      return {
        mode: "cloud",
        label: "Cloud AI",
        ready: true,
        readinessState: "ready",
        detail: "Connected to cloud AI service.",
      };
    }
    const diag = core.voice.llmDiagnostics;
    if (diag && (diag.status === "binary-missing" || diag.status === "model-missing")) {
      return {
        mode: "heuristic",
        label: "Running locally",
        ready: true,
        readinessState: "missing",
        detail: "Local AI model not detected. Using local fallback engine.",
      };
    }
    return {
      mode: "heuristic",
      label: "Running locally",
      ready: true,
      readinessState: "ready",
      detail: "Basic local assistance is available.",
    };
  });

  ipcMain.handle(IPC_CHANNELS.listConversations, () => core.conversations.list());

  ipcMain.handle(
    IPC_CHANNELS.createConversation,
    (_event: Electron.IpcMainInvokeEvent, title?: unknown) =>
      core.conversations.create(assertOptionalString(title, "title", 256)),
  );

  ipcMain.handle(
    IPC_CHANNELS.renameConversation,
    (_event: Electron.IpcMainInvokeEvent, id: unknown, title: unknown) =>
      core.conversations.rename(
        assertString(id, "id", 256),
        assertString(title, "title", 256),
      ),
  );

  ipcMain.handle(
    IPC_CHANNELS.archiveConversation,
    (_event: Electron.IpcMainInvokeEvent, id: unknown, archived: unknown) =>
      core.conversations.setArchived(
        assertString(id, "id", 256),
        assertBoolean(archived, "archived"),
      ),
  );

  ipcMain.handle(
    IPC_CHANNELS.deleteConversation,
    (_event: Electron.IpcMainInvokeEvent, id: unknown) =>
      core.conversations.delete(assertString(id, "id", 256)),
  );

  ipcMain.handle(
    IPC_CHANNELS.listMessages,
    (_event: Electron.IpcMainInvokeEvent, conversationId: unknown) =>
      core.conversations.listMessages(assertString(conversationId, "conversationId", 256)),
  );

  async function sendTurn(request: SendMessageRequest): Promise<SendMessageResponse> {
    await core.conversations.appendMessage(request.conversationId, "user", request.content);
    const controller = request.turnId ? new AbortController() : undefined;
    if (request.turnId && controller) inFlightTurns.set(request.turnId, controller);
    let reply;
    try {
      reply = await runTextTurn(
        request.conversationId,
        request.content,
        core.webShell.getDeviceState(),
        {
          orchestrator: core.voice.orchestrator,
          capabilityManager: core.capabilityManager,
          powerConfirmation: core.voice.powerConfirmation,
          cloudLLMConfigured: core.voice.cloudLLMConfigured,
        },
        controller?.signal,
        (progress) => {
          broadcastProgress({
            conversationId: request.conversationId,
            ...(request.turnId !== undefined ? { turnId: request.turnId } : {}),
            stage: progress.stage,
            label: progress.label,
          });
        },
      );
    } finally {
      if (request.turnId) inFlightTurns.delete(request.turnId);
    }
    const message = await core.conversations.appendMessage(
      request.conversationId,
      "assistant",
      reply.reply,
      reply.routingTarget,
      reply.toolActivity,
      reply.cancelled,
    );
    log.info("turn sent", {
      conversationId: request.conversationId,
      routingTarget: reply.routingTarget,
      cancelled: reply.cancelled === true,
      toolCalls: reply.toolActivity.length,
    });
    return {
      content: reply.reply,
      routingTarget: reply.routingTarget,
      retrievedContext: [],
      message,
      toolActivity: reply.toolActivity,
      ...(reply.cancelled ? { cancelled: true } : {}),
    };
  }

  ipcMain.handle(
    IPC_CHANNELS.sendMessage,
    (_event: Electron.IpcMainInvokeEvent, request: unknown) => {
      if (typeof request !== "object" || request === null) {
        throw new TypeError("expected object for SendMessageRequest");
      }
      const req = request as Record<string, unknown>;
      const turnId = assertOptionalString(req["turnId"], "turnId", 256);
      const validReq: SendMessageRequest = {
        conversationId: assertString(req["conversationId"], "conversationId", 256),
        content: assertString(req["content"], "content", 100_000),
        ...(turnId !== undefined ? { turnId } : {}),
      };
      return sendTurn(validReq);
    },
  );

  ipcMain.handle(IPC_CHANNELS.cancelTurn, (_event: Electron.IpcMainInvokeEvent, turnId: unknown) => {
    if (typeof turnId === "string" && turnId.length <= 256) {
      inFlightTurns.get(turnId)?.abort();
    }
  });

  ipcMain.handle(IPC_CHANNELS.getCurrentReference, () => {
    const reference = core.voice.contextTracker.get();
    if (!reference) return undefined;
    // Strip the internal `timestamp` field — the renderer only needs to
    // know *what* "open this" would resolve to, not when it was set;
    // exposing raw internal bookkeeping isn't warranted here.
    const { timestamp: _timestamp, ...payload } = reference;
    return payload;
  });

  ipcMain.handle(
    IPC_CHANNELS.deleteMessage,
    (_event: Electron.IpcMainInvokeEvent, conversationId: unknown, messageId: unknown) =>
      core.conversations.deleteMessage(
        assertString(conversationId, "conversationId", 256),
        assertString(messageId, "messageId", 256),
      ),
  );

  ipcMain.handle(
    IPC_CHANNELS.regenerateMessage,
    async (_event: Electron.IpcMainInvokeEvent, conversationId: unknown, messageId: unknown) => {
      const convId = assertString(conversationId, "conversationId", 256);
      const msgId = assertString(messageId, "messageId", 256);
      const history = await core.conversations.listMessages(convId);
      const target = history.find((m) => m.id === msgId);
      if (!target) throw new Error(`no message with id "${msgId}"`);
      const priorUser = [...history]
        .slice(0, history.indexOf(target))
        .reverse()
        .find((m) => m.role === "user");
      if (!priorUser) throw new Error("no prior user message to regenerate a reply for");
      await core.conversations.deleteMessage(convId, msgId);
      const reply = await runTextTurn(
        convId,
        priorUser.content,
        core.webShell.getDeviceState(),
        {
          orchestrator: core.voice.orchestrator,
          capabilityManager: core.capabilityManager,
          powerConfirmation: core.voice.powerConfirmation,
          cloudLLMConfigured: core.voice.cloudLLMConfigured,
        },
        undefined,
        (progress) => {
          broadcastProgress({
            conversationId: convId,
            stage: progress.stage,
            label: progress.label,
          });
        },
      );
      const message = await core.conversations.appendMessage(
        convId,
        "assistant",
        reply.reply,
        reply.routingTarget,
        reply.toolActivity,
        reply.cancelled,
      );
      return {
        content: reply.reply,
        routingTarget: reply.routingTarget,
        retrievedContext: [],
        message,
        toolActivity: reply.toolActivity,
        ...(reply.cancelled ? { cancelled: true } : {}),
      };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.searchMemory,
    async (_event: Electron.IpcMainInvokeEvent, query: unknown) => {
      const validQuery = assertString(query, "query", 2_000);
      if (validQuery.trim().length === 0) return [];
      const lowered = validQuery.toLowerCase();
      // Real short-term conversation history from the AI Engine's own
      // `SessionManager` (docs/adr/0032) — replaces a dead read against
      // `ConversationEngine`'s short-term buffer, which nothing ever
      // populated once text chat was rewired to the real orchestrator
      // (see `text-chat.ts`). Searches across every active session,
      // matching the original implementation's own behavior: it read a
      // single, conversation-agnostic recency buffer, not one scoped to
      // a specific conversationId.
      const results: {
        id: string;
        category: "fact";
        content: string;
        importance: number;
        createdAt: string;
      }[] = [];
      for (const session of core.voice.aiSessionManager.list()) {
        const { history } = await session.context.gather("");
        for (const [index, turn] of history.entries()) {
          if (turn.content.toLowerCase().includes(lowered)) {
            results.push({
              id: `short-term-${session.id}-${index}`,
              category: "fact",
              content: turn.content,
              importance: 0.5,
              createdAt: session.lastActiveAt,
            });
          }
        }
      }
      return results;
    },
  );

  ipcMain.handle(IPC_CHANNELS.getSettings, () => core.settings.load());

  ipcMain.handle(
    IPC_CHANNELS.updateSettings,
    async (_event: Electron.IpcMainInvokeEvent, patch: unknown) => {
      const sanitized = sanitizeSettingsPatch(patch);
      const updated = await core.settings.update(sanitized);
      for (const contents of deps.getSettingsWindows()) {
        if (!contents.isDestroyed()) contents.send(IPC_CHANNELS.settingsChanged, updated);
      }
      return updated;
    },
  );

  ipcMain.handle(IPC_CHANNELS.getHealth, () => core.getHealth());

  ipcMain.handle(IPC_CHANNELS.openSettingsWindow, () => {
    deps.openSettingsWindow();
  });

  ipcMain.handle(IPC_CHANNELS.startVoiceTurn, () => deps.startVoiceTurn());
  ipcMain.handle(IPC_CHANNELS.stopVoiceTurn, () => deps.stopVoiceTurn());

  async function computeAudioStatus(): Promise<AudioStatusPayload> {
    await core.voice.deviceManager.refresh();
    const availability = async (kind: AudioDeviceKindPayload): Promise<AudioAvailability> => {
      const device = core.voice.deviceManager.getDefault(kind);
      if (!device) return "unavailable";
      const granted = await core.voice.deviceManager.hasPermission(kind);
      return granted ? "available" : "permission-denied";
    };
    const micName = core.voice.deviceManager.getDefault("microphone")?.name;
    const speakerName = core.voice.deviceManager.getDefault("speaker")?.name;
    const outputRoutingWarning = core.voice.audioBridge?.getLastSinkRoutingWarning();
    return {
      microphone: await availability("microphone"),
      speaker: await availability("speaker"),
      ...(micName !== undefined ? { selectedMicrophoneName: micName } : {}),
      ...(speakerName !== undefined ? { selectedSpeakerName: speakerName } : {}),
      ...(outputRoutingWarning !== undefined ? { outputRoutingWarning } : {}),
    };
  }

  ipcMain.handle(
    IPC_CHANNELS.listAudioDevices,
    async (_event: Electron.IpcMainInvokeEvent, kind?: unknown) => {
      await core.voice.deviceManager.refresh();
      const validKind =
        kind === "microphone" || kind === "speaker"
          ? (kind as AudioDeviceKindPayload)
          : undefined;
      return core.voice.deviceManager.list(validKind).map((d) => ({ ...d }));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.selectAudioDevice,
    (_event: Electron.IpcMainInvokeEvent, kind: unknown, deviceId: unknown) => {
      if (kind !== "microphone" && kind !== "speaker") {
        throw new TypeError(`invalid audio device kind: ${String(kind)}`);
      }
      const devId = assertString(deviceId, "deviceId", 512);
      if (kind === "microphone") core.voice.microphoneManager.selectDevice(devId);
      else {
        core.voice.speakerManager.selectDevice(devId);
        core.voice.audioBridge?.clearLastSinkRoutingWarning();
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.getAudioStatus, () => computeAudioStatus());

  ipcMain.handle(
    IPC_CHANNELS.requestAudioPermission,
    (_event: Electron.IpcMainInvokeEvent, kind: unknown) => {
      if (kind !== "microphone" && kind !== "speaker") {
        throw new TypeError(`invalid audio device kind: ${String(kind)}`);
      }
      return core.voice.deviceManager.requestPermission(kind);
    },
  );

  ipcMain.handle(IPC_CHANNELS.listPermissions, () => {
    return KNOWN_PERMISSION_CATEGORIES.map((item) => {
      const policy = core.broker.getPolicy(item.capability, "ai-orchestrator");
      return {
        id: item.capability,
        category: item.category,
        description: item.description,
        granted: core.broker.hasGrant("ai-orchestrator", item.capability),
        isSessionOnly: item.capability !== "system.power" && policy === "prompt",
        policy,
      };
    });
  });

  ipcMain.handle(
    IPC_CHANNELS.setPermissionPolicy,
    async (_event: Electron.IpcMainInvokeEvent, capability: unknown, policy: unknown) => {
      const cap = assertString(capability, "capability", 128) as Capability;
      if (policy !== "always" && policy !== "prompt" && policy !== "denied") {
        throw new TypeError(`invalid permission policy: ${String(policy)}`);
      }
      core.broker.setPolicy(cap, policy as PermissionPolicy, "ai-orchestrator");
      core.broker.setPolicy(cap, policy as PermissionPolicy, "voice-session");
      core.broker.setPolicy(cap, policy as PermissionPolicy);
      const currentSettings = await core.settings.load();
      const updatedPolicies = {
        ...(currentSettings.persistentPermissions ?? {}),
        [cap]: policy as PermissionPolicy,
      };
      await core.settings.update({ persistentPermissions: updatedPolicies });
      log.info("permission policy set and persisted", { capability: cap, policy });
    },
  );

  ipcMain.handle(IPC_CHANNELS.resetPermissions, async () => {
    for (const item of KNOWN_PERMISSION_CATEGORIES) {
      if (item.capability !== "notifications") {
        core.broker.revoke("ai-orchestrator", item.capability);
        core.broker.revoke("voice-session", item.capability);
        core.broker.setPolicy(item.capability, "prompt", "ai-orchestrator");
        core.broker.setPolicy(item.capability, "prompt", "voice-session");
        core.broker.setPolicy(item.capability, "prompt");
      }
    }
    await core.settings.update({ persistentPermissions: {} });
    log.info("session and persistent permissions reset");
  });

  ipcMain.handle(IPC_CHANNELS.restartLocalAI, async (): Promise<{ ok: boolean; message: string }> => {
    log.info("restartLocalAI requested via IPC");
    try {
      const res = await fetch("http://127.0.0.1:8090/health", { signal: AbortSignal.timeout(2500) }).catch(() => null);
      if (res && res.ok) {
        return { ok: true, message: "Local AI engine is active and ready." };
      }
      return {
        ok: false,
        message: "Local AI is not responding. Please ensure your local AI server is active.",
      };
    } catch (err) {
      log.warn("restartLocalAI check error", { error: String(err) });
      return { ok: false, message: "Could not restart local AI right now." };
    }
  });

  ipcMain.handle(IPC_CHANNELS.openLogsFolder, async (): Promise<void> => {
    log.info("openLogsFolder invoked via IPC");
    try {
      const logsPath = app.getPath("logs");
      await shell.openPath(logsPath);
    } catch (err) {
      log.warn("failed to open logs folder", { error: String(err) });
    }
  });

  log.info("IPC handlers registered", { channelCount: Object.keys(IPC_CHANNELS).length });
}

export function broadcast(
  windows: readonly BrowserWindow[],
  channel: string,
  payload: unknown,
): void {
  for (const win of windows) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

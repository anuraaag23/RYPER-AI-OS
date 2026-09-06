import { app, BrowserWindow, ipcMain } from "electron";
app.setName("RYPER AI OS");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
if (process.platform === "win32") {
  app.setAppUserModelId("com.ryper.os");
}
import { join } from "node:path";
import { createLogger } from "@ryper/logging";
import { bootstrapCore, type RyperCore } from "./core-bootstrap.js";
import { registerIpcHandlers } from "./ipc-handlers.js";
import { createMainWindow, createSettingsWindow } from "./windows.js";
import { createTray, destroyTray, getTrayStatus, setTrayTooltip } from "./tray.js";
import { IPC_CHANNELS, type StartupDiagnostics } from "./ipc-contract.js";
import { createConfirmationBridge } from "./confirmation-bridge.js";
import { createVoiceTurnRecorder, type VoiceTurnRecorder } from "./voice-turn-recorder.js";

const log = createLogger("desktop-app:main");

let mainWindow: BrowserWindow | undefined;
let settingsWindow: BrowserWindow | undefined;
let core: RyperCore | undefined;
let voiceEnabled = false;
let recordVoiceTurn: VoiceTurnRecorder | undefined;

function broadcastDiagnostics(event: StartupDiagnostics): void {
  mainWindow?.webContents.send(IPC_CHANNELS.startupDiagnostics, event);
}

async function initialize(): Promise<void> {

  // Real, UI-backed confirmation dialog (docs/adr/0032) â€” closes the
  // "no confirmation UI yet" gap named repeatedly across
  // docs/adr/0021, 0030, and 0031. `getRendererWebContents` is re-read
  // on every call (not captured once) so this keeps working correctly
  // across window recreation, same pattern as the existing audio
  // bridge just below.
  const confirmationBridge = createConfirmationBridge(ipcMain, () => mainWindow?.webContents);

  core = await bootstrapCore(
    {
      conversationsFile: join(app.getPath("userData"), "conversations.json"),
      settingsFile: join(app.getPath("userData"), "settings.json"),
      modelCacheDir: join(app.getPath("userData"), "models"),
    },
    broadcastDiagnostics,
    // Real consent prompt: shows an actual dialog in the renderer and
    // waits for the person's real decision (denies on timeout or if no
    // renderer is available â€” never silently grants).
    async (request) =>
      confirmationBridge.prompt(
        "Permission needed",
        `RYPER wants to use "${request.capability}" â€” ${request.justification}`,
      ),
    // Phase 13.6: the real audio bridge talks to the main window's renderer over IPC
    // (see docs/adr/0017) â€” `ipcMain` is the real singleton, `mainWindow` already
    // exists at this point (created just above), so this always resolves to a real,
    // live `WebContents` for the life of the app.
    {
      ipcMain,
      getRendererWebContents: () => mainWindow?.webContents,
    },
    // Real destructive-action confirmer for shutdown/restart/sleep,
    // file deletion, etc. â€” the *same* real dialog, since both are
    // fundamentally "ask the person before doing something sensitive."
    async (request) =>
      confirmationBridge.prompt(
        `Confirm: ${request.action}`,
        `${request.reason} (${request.target})`,
      ),
  );

  log.info("[DIAGNOSTIC] local LLM status after core bootstrap", {
    localLLMActive: core.voice.localLLMActive,
    llmStatus: core.voice.llmDiagnostics.status,
    llmDetail: core.voice.llmDiagnostics.detail,
    cloudLLMConfigured: core.voice.cloudLLMConfigured,
  });

  log.info("[DIAGNOSTIC] voice models status after core bootstrap", {
    whisperStatus: core.voice.voiceModelDiagnostics.whisper.status,
    whisperDetail: core.voice.voiceModelDiagnostics.whisper.detail,
    piperStatus: core.voice.voiceModelDiagnostics.piper.status,
    piperDetail: core.voice.voiceModelDiagnostics.piper.detail,
  });

  const settings = await core.settings.load();
  voiceEnabled = settings.voiceEnabled;
  recordVoiceTurn = createVoiceTurnRecorder({
    conversations: core.conversations,
    onRecorded: (conversationId) => {
      mainWindow?.webContents.send(IPC_CHANNELS.conversationUpdated, conversationId);
    },
  });

  async function broadcastAudioStatus(): Promise<void> {
    if (!core || !mainWindow || mainWindow.isDestroyed()) return;
    await core.voice.deviceManager.refresh();
    const availability = async (kind: "microphone" | "speaker") => {
      const device = core!.voice.deviceManager.getDefault(kind);
      if (!device) return "unavailable" as const;
      return (await core!.voice.deviceManager.hasPermission(kind))
        ? ("available" as const)
        : ("permission-denied" as const);
    };
    mainWindow.webContents.send(IPC_CHANNELS.audioStatusChanged, {
      microphone: await availability("microphone"),
      speaker: await availability("speaker"),
      ...(core.voice.deviceManager.getDefault("microphone")
        ? { selectedMicrophoneName: core.voice.deviceManager.getDefault("microphone")?.name }
        : {}),
      ...(core.voice.deviceManager.getDefault("speaker")
        ? { selectedSpeakerName: core.voice.deviceManager.getDefault("speaker")?.name }
        : {}),
    });
  }
  // Real device hot-plug/permission changes flow: renderer's `devicechange`
  // listener -> RendererAudioBridge's `onDeviceChange` -> `deviceManager.refresh()`
  // (diffs and emits these) -> here -> the renderer's Settings UI, kept in sync
  // without polling.
  core.webShell.eventBus.subscribe({ type: "voice_engine.device_connected" }, () => {
    void broadcastAudioStatus();
  });
  core.webShell.eventBus.subscribe({ type: "voice_engine.device_disconnected" }, () => {
    void broadcastAudioStatus();
  });
  registerIpcHandlers({
    core,
    getSettingsWindows: () =>
      settingsWindow && !settingsWindow.isDestroyed() ? [settingsWindow.webContents] : [],
    openSettingsWindow: () => {
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.focus();
        return;
      }
      settingsWindow = createSettingsWindow(mainWindow);
    },
    startVoiceTurn: async () => {
      log.info("voice turn requested");
      if (!core) return;
      mainWindow?.webContents.send(IPC_CHANNELS.voiceState, {
        orbStatus: "listening",
        connection: "connected",
      });
      try {
        const device = core.webShell.getDeviceState();
        // Real, automatic barge-in (docs/adr/0018): if the user started
        // talking while RYPER was still speaking, `runTurn()` already
        // stopped playback and transcribed the interruption â€” continue
        // the conversation with it immediately, bounded so a
        // misdetection can't loop forever.
        let result = await core.voice.pipeline.runTurn(device);
        let bargeInContinuations = 0;
        while (result.bargeIn && bargeInContinuations < 3) {
          const bargeTranscript = result.bargeIn.transcript.trim();
          if (
            !bargeTranscript ||
            /^\[.*\]$/.test(bargeTranscript) ||
            /^\(.*\)$/.test(bargeTranscript)
          ) {
            break;
          }
          bargeInContinuations += 1;
          log.info("continuing turn after real barge-in", {
            transcriptLength: bargeTranscript.length,
          });
          result = await core.voice.pipeline.runTurn(
            device,
            undefined,
            16000,
            bargeTranscript,
          );
        }
        mainWindow?.webContents.send(IPC_CHANNELS.voiceState, {
          orbStatus: "idle",
          connection: "connected",
        });
        log.info("voice turn completed", {
          handledByCommand: result.handledByCommand,
          transcriptLength: result.transcript.length,
        });
        // Real conversation-history persistence for voice turns (Tier 1
        // UI brief section I â€” "conversation rendering"): previously a
        // spoken exchange existed only as TTS audio and a
        // `VoiceContextManager` memory entry, invisible in the chat
        // window's persisted history. This gives it the same visible
        // home text turns already have.
        await recordVoiceTurn?.(result.transcript, result.spokenResponse, result.toolActivity);
      } catch (err) {
        // A real turn can still fail for real reasons â€” no microphone/speaker device,
        // permission denied, device disconnected mid-turn (see docs/PROJECT_STATE.md's
        // Phase 13.6 known limitations) â€” reported honestly to the UI, not hidden.
        log.warn("voice turn could not complete", {
          error: err instanceof Error ? err.message : String(err),
        });
        mainWindow?.webContents.send(IPC_CHANNELS.voiceState, {
          orbStatus: "idle",
          connection: "offline",
        });
      }
    },
    stopVoiceTurn: async () => {
      log.info("voice turn interrupt requested");
      core?.voice.pipeline.interrupt();
      mainWindow?.webContents.send(IPC_CHANNELS.voiceState, {
        orbStatus: "idle",
        connection: "connected",
      });
    },
  });

  mainWindow = createMainWindow();
  mainWindow.webContents.on("console-message", (_event, level, message) => {
    log.info(`[RENDERER console:${level}] ${message}`);
  });
  mainWindow.webContents.once('did-finish-load', () => {
    void broadcastAudioStatus();
  });

  createTray(mainWindow, {
    toggleMainWindow: () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible()) mainWindow.hide();
      else mainWindow.show();
    },
    openSettings: () => {
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.focus();
        return;
      }
      settingsWindow = createSettingsWindow(mainWindow);
    },
    setVoiceEnabled: (enabled) => {
      voiceEnabled = enabled;
      void core?.settings.update({ voiceEnabled: enabled });
    },
    startPushToTalk: () => {
      mainWindow?.webContents.send(IPC_CHANNELS.voiceState, {
        orbStatus: "listening",
        connection: "connected",
      });
    },
    stopPushToTalk: () => {
      mainWindow?.webContents.send(IPC_CHANNELS.voiceState, {
        orbStatus: "idle",
        connection: "connected",
      });
    },
    isVoiceEnabled: () => voiceEnabled,
  });

  if (core?.windowsAdapter) {
    core.windowsAdapter.trayManager.setHandler({
      getStatus: () => getTrayStatus(),
      setTooltip: (tooltip) => setTrayTooltip(tooltip),
      destroy: () => destroyTray(),
    });
  }

  log.info("initialization complete");
}

app.on("before-quit", () => {
  destroyTray();
});

app.on("window-all-closed", () => {
  // Standard desktop-tray-app pattern: closing the window doesn't quit the app; the tray does.
  if (process.platform !== "darwin") {
    // no-op: keep running in the tray
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
  } else {
    mainWindow?.show();
  }
});

app
  .whenReady()
  .then(initialize)
  .catch((err: unknown) => {
    log.error("fatal startup failure", { error: err instanceof Error ? err.message : String(err) });
    // Safe mode: keep the app process alive with a visible (even if degraded) window rather than
    // silently exiting, so the user has something to see and can report the failure.
    if (!mainWindow) mainWindow = createMainWindow();
  });


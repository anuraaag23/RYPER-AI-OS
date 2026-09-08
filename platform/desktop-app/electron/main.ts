import { app, BrowserWindow, ipcMain, globalShortcut } from "electron";
app.setName("RYPER AI OS");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
if (process.env["RYPER_TEST_PROFILE"]) {
  app.setPath("userData", process.env["RYPER_TEST_PROFILE"]);
}
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
import { describeCapabilityRequest } from "./capability-presentation.js";
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
  // Create mainWindow early so webContents is immediately available for audio bridge,
  // confirmations, and startup diagnostics
  mainWindow = createMainWindow();
  mainWindow.webContents.on("console-message", (_event, level, message) => {
    log.info(`[RENDERER console:${level}] ${message}`);
  });
  mainWindow.webContents.once("did-finish-load", () => {
    void broadcastAudioStatus();
  });

  // Real, UI-backed confirmation dialog (docs/adr/0032)
  const confirmationBridge = createConfirmationBridge(ipcMain, () => mainWindow?.webContents);

  core = await bootstrapCore(
    {
      conversationsFile: join(app.getPath("userData"), "conversations.json"),
      settingsFile: join(app.getPath("userData"), "settings.json"),
      modelCacheDir: join(app.getPath("userData"), "models"),
    },
    broadcastDiagnostics,
    async (request) => {
      const presentation = describeCapabilityRequest(request);
      return confirmationBridge.prompt(
        presentation.title,
        presentation.message,
        presentation.approveLabel,
        presentation.denyLabel,
        request.capability,
      );
    },
    {
      ipcMain,
      getRendererWebContents: () => mainWindow?.webContents,
    },
    async (request) =>
      confirmationBridge.prompt(
        `Confirm: ${request.action}`,
        `${request.reason} (${request.target})`,
        "Approve",
        "Deny",
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

  let isVoiceTurnRunning = false;
  async function executeVoiceTurn(): Promise<void> {
    if (isVoiceTurnRunning) {
      log.info("voice turn already running, interrupting");
      core?.voice.pipeline.interrupt();
      return;
    }
    isVoiceTurnRunning = true;
    log.info("voice turn requested");
    if (!core) {
      isVoiceTurnRunning = false;
      return;
    }
    mainWindow?.webContents.send(IPC_CHANNELS.voiceState, {
      orbStatus: "listening",
      connection: "connected",
    });
    try {
      const device = core.webShell.getDeviceState();
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
      await recordVoiceTurn?.(result.transcript, result.spokenResponse, result.toolActivity);
    } catch (err) {
      log.warn("voice turn could not complete", {
        error: err instanceof Error ? err.message : String(err),
      });
      mainWindow?.webContents.send(IPC_CHANNELS.voiceState, {
        orbStatus: "idle",
        connection: "offline",
      });
    } finally {
      isVoiceTurnRunning = false;
    }
  }

  function registerPttShortcut(shortcutKey?: string): void {
    const key = shortcutKey || "CommandOrControl+Shift+Space";
    try {
      globalShortcut.unregisterAll();
      const success = globalShortcut.register(key, () => {
        log.info("PTT global shortcut triggered", { key });
        if (mainWindow) {
          if (!mainWindow.isVisible()) {
            mainWindow.show();
          }
          mainWindow.focus();
        }
        void executeVoiceTurn();
      });
      log.info("PTT global shortcut registration status", { key, success });
    } catch (err) {
      log.warn("failed to register PTT global shortcut", { key, error: String(err) });
    }
  }

  registerPttShortcut(settings.pushToTalkShortcut);

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
    getChatWindows: () =>
      mainWindow && !mainWindow.isDestroyed() ? [mainWindow.webContents] : [],
    openSettingsWindow: () => {
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.focus();
        return;
      }
      settingsWindow = createSettingsWindow(mainWindow);
    },
    startVoiceTurn: executeVoiceTurn,
    stopVoiceTurn: async () => {
      log.info("voice turn interrupt requested");
      core?.voice.pipeline.interrupt();
      mainWindow?.webContents.send(IPC_CHANNELS.voiceState, {
        orbStatus: "idle",
        connection: "connected",
      });
    },
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
      void executeVoiceTurn();
    },
    stopPushToTalk: () => {
      core?.voice.pipeline.interrupt();
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

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

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


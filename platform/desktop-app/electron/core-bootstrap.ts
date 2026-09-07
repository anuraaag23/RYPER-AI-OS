import { createWebShell, type WebShell } from "@ryper/web-shell";
import { CapabilityBroker, type ConsentPrompt } from "@ryper/security";
import { createCapabilityManager, type CapabilityManager } from "@ryper/platform-capability";
import {
  createWindowsAdapter,
  createPowerShellWindowsSystemApi,
  WINDOWS_CAPABILITY_DESCRIPTORS,
  type DestructiveActionConfirmer,
} from "@ryper/windows-agent";
import { createLogger } from "@ryper/logging";
import { createNodePowerShellExec } from "./windows-shell-exec.js";
import type { HealthCheckSummary, StartupDiagnostics } from "./ipc-contract.js";
import { ConversationStore } from "./conversation-store.js";
import { SettingsStore } from "./settings-store.js";
import { bootstrapMemoryManager } from "./memory-bootstrap.js";
import {
  bootstrapVoice,
  type VoiceBundle,
  type VoiceBootstrapAudioIpc,
} from "./voice-bootstrap.js";
import { provisionLocalModels } from "./local-model-provisioner.js";

import type { PlatformId } from "@ryper/platform-capability";

const log = createLogger("desktop-app:core-bootstrap");

function detectPlatformId(): PlatformId {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    default:
      // @ryper/platform-capability has no adapter for this OS; "linux" is the closest
      // desktop-shaped fallback so capability resolution still runs (and reports
      // everything unsupported via runtime limitations) instead of throwing.
      return "linux";
  }
}

export interface RyperCore {
  readonly webShell: WebShell;
  readonly capabilityManager: CapabilityManager;
  readonly broker: CapabilityBroker;
  readonly conversations: ConversationStore;
  readonly settings: SettingsStore;
  readonly voice: VoiceBundle;
  readonly windowsAdapter?: Awaited<ReturnType<typeof createWindowsAdapter>> | undefined;
  getHealth(): Promise<HealthCheckSummary>;
}

export interface BootstrapPaths {
  readonly conversationsFile: string;
  readonly settingsFile: string;
  readonly modelCacheDir: string;
}

/**
 * The desktop app's one real initialization pipeline. Still uses
 * `@ryper/web-shell`'s `createWebShell()` for its real `EventBus` and
 * `getDeviceState()` reader, but **not** for real chat anymore —
 * `createWebShell()`'s `ConversationEngine` runs entirely on
 * placeholder echo model providers unless real ones are injected
 * (which nothing here ever did), so real text chat is routed through
 * the real, shared `AIOrchestrator` instance instead (`voice.orchestrator`,
 * via `text-chat.ts`'s `runTextTurn` — see docs/adr/0032). Adds the
 * pieces a desktop shell specifically needs on top: a
 * `CapabilityBroker`/`CapabilityManager` (real permission-gated
 * platform access, per `@ryper/platform-capability`), the Windows
 * Platform Agent (registered only on `win32` — no macOS/Linux
 * `PlatformAdapter` exists yet; see `docs/PROJECT_STATE.md`'s known
 * gaps), and the desktop-only conversation/settings persistence
 * stores.
 *
 * Every step is reported via `onDiagnostics`, driving the splash
 * screen's real (not simulated) startup progress.
 */
export async function bootstrapCore(
  paths: BootstrapPaths,
  onDiagnostics: (event: StartupDiagnostics) => void,
  consentPrompt: ConsentPrompt,
  audioIpc?: VoiceBootstrapAudioIpc,
  // Real, UI-backed destructive-action confirmer (docs/adr/0032) —
  // optional purely for backward compatibility with any existing
  // caller/test that doesn't pass one; omitting it means
  // `createWindowsAdapter()` falls back to its own honest
  // deny-everything default, exactly as before this fix, not a silent
  // downgrade in behavior.
  destructiveActionConfirmer?: DestructiveActionConfirmer,
): Promise<RyperCore> {
  const report = (step: string, run: () => void | Promise<void>): Promise<void> =>
    Promise.resolve()
      .then(run)
      .then(() => {
        onDiagnostics({ step, ok: true });
        log.info("startup step ok", { step });
      })
      .catch((err: unknown) => {
        const detail = err instanceof Error ? err.message : String(err);
        onDiagnostics({ step, ok: false, detail });
        log.error("startup step failed", { step, detail });
        throw err;
      });

  let webShell!: WebShell;
  await report("core services (event bus, model router, memory, conversation)", () => {
    webShell = createWebShell();
  });

  let capabilityManager!: CapabilityManager;
  let broker!: CapabilityBroker;
  await report("security & platform capability layer", () => {
    broker = new CapabilityBroker(consentPrompt);
    capabilityManager = createCapabilityManager({
      broker,
      platformDetector: detectPlatformId,
    });
  });

  let windowsAdapter: Awaited<ReturnType<typeof createWindowsAdapter>> | undefined;
  if (process.platform === "win32") {
    await report("windows platform agent", async () => {
      // Real PowerShell-backed system API (docs/adr/0021) — previously
      // `createWindowsAdapter()` was always called with no `systemApi`
      // override here, which silently defaults to the in-memory
      // reference implementation even on real Windows. Every desktop
      // capability (volume, app launch, notifications, ...) was
      // therefore operating against a fake in-process model, never real
      // Win32/WMI state, until this fix.
      windowsAdapter = await createWindowsAdapter({
        systemApi: createPowerShellWindowsSystemApi(createNodePowerShellExec()),
        allowRegistryWrites: true,
        ...(destructiveActionConfirmer ? { destructiveActionConfirmer } : {}),
      });
      capabilityManager.registerAdapter(windowsAdapter);
      // Real capability-broker gating (docs/adr/0021) — previously
      // nothing ever registered `WINDOWS_CAPABILITY_DESCRIPTORS` with
      // `CapabilityManager`, so `CapabilityManager.invoke()`'s permission
      // check (`if (descriptor) { ... await this.permissions.
      // requestPermission(...) ... }`) always found `descriptor`
      // `undefined` and skipped straight past `CapabilityBroker`
      // entirely — for every domain, including the ones
      // (`notifications`, `filesystem.write`, `automation.execute`)
      // whose descriptors declare a `requiredCapability`. Registering
      // these makes real consent-gating for those domains actually
      // reachable for the first time. Domains with no
      // `requiredCapability` set (`audio`, `application_control`,
      // `window_management`, `clipboard`, `display`,
      // `device_information`, `security`, `diagnostics`) are unaffected
      // — they were, and remain, intentionally ungated.
      for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
        capabilityManager.registerCapability(descriptor);
      }
      // Safe, non-destructive desktop notifications: pre-authorizes the AI orchestrator actor
      // so ToolRegistry.invoke's prior-grant check succeeds on real Windows runs (docs/adr/0021).
      broker.grant("ai-orchestrator", "notifications");
    });
  } else {
    onDiagnostics({
      step: "platform agent",
      ok: true,
      detail: `no PlatformAdapter is implemented for "${process.platform}" yet — platform-specific capabilities are unavailable this run`,
    });
  }

  let conversations!: ConversationStore;
  await report("conversation history", () => {
    conversations = new ConversationStore(paths.conversationsFile);
  });

  let settings!: SettingsStore;
  await report("settings", async () => {
    settings = new SettingsStore(paths.settingsFile);
    await settings.load();
  });

  if (!process.env["VITEST"]) {
    await report("local AI runtime provisioning & detection", async () => {
      try {
        const status = await provisionLocalModels(paths.modelCacheDir);
        log.info("local model provisioning complete", {
          provisionedCount: status.provisionedCount,
          llamaModel: status.llama.model,
          whisperModel: status.whisper.model,
          piperModel: status.piper.model,
        });
      } catch (err) {
        log.warn("local model provisioning notice", { error: String(err) });
      }
    });
  }

  let voice!: VoiceBundle;
  await report("voice pipeline (wake word, VAD, STT/TTS, session, commands, memory)", async () => {
    const memoryManager = bootstrapMemoryManager(webShell.eventBus);
    voice = await bootstrapVoice(
      memoryManager,
      capabilityManager,
      broker,
      { modelCacheDir: paths.modelCacheDir },
      webShell.eventBus,
      audioIpc,
      // Read live off the already-loaded, cached settings rather than
      // capturing today's value once — a user changing their preferred
      // browser in Settings takes effect on the very next open, no
      // restart required.
      () => settings.getCached()?.preferredBrowserId,
      () => ({
        voiceLanguage: settings.getCached()?.voiceLanguage,
        ttsVoice: settings.getCached()?.ttsVoice,
      }),
    );
  });

  async function getHealth(): Promise<HealthCheckSummary> {
    if (windowsAdapter) {
      const health = await windowsAdapter.diagnosticsManager.healthCheck();
      const info = windowsAdapter.getDeviceInfo();
      const discovery = capabilityManager.discover("desktop-app", "windows");
      return {
        status: health.status,
        platform: info.platform,
        platformVersion: info.platformVersion,
        capabilitiesSupported: discovery.supportedDomains.length,
        capabilitiesTotal: discovery.supportedDomains.length + discovery.unsupportedDomains.length,
        details: health.details,
      };
    }
    return {
      status: "degraded",
      platform: process.platform,
      platformVersion: process.version,
      capabilitiesSupported: 0,
      capabilitiesTotal: 0,
      details: [`no PlatformAdapter is registered for "${process.platform}"`],
    };
  }

  log.info("core bootstrap complete");
  return { webShell, capabilityManager, broker, conversations, settings, voice, windowsAdapter, getHealth };
}

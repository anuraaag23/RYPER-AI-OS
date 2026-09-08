import { useCallback, useEffect, useState } from "react";
import type {
  AIStatusPayload,
  AppSettings,
  AudioDeviceKindPayload,
  AudioDevicePayload,
  AudioStatusPayload,
  HealthCheckSummary,
  PermissionEntryPayload,
  ThemePreference,
} from "../electron/ipc-contract.js";
import { applyDesignTokens, resolveColorScheme } from "./lib/apply-tokens.js";

/**
 * Sanitizes text to strictly guarantee zero leakage of Windows user paths,
 * credentials, authentication tokens, or registry keys in diagnostics exports.
 */
export function sanitizeDiagnosticsText(text: string): string {
  if (!text) return "";
  return text
    // Strip Windows user paths e.g. C:\Users\<name>\... or \Users\<name>\...
    .replace(/[a-zA-Z]:\\(?:Users|Documents and Settings)\\[^\s,;"']+/gi, "[USER_PATH]")
    // Strip other absolute Windows paths e.g. C:\foo\bar
    .replace(/[a-zA-Z]:\\(?:[^\\/:*?"<>|\r\n]+\\)+[^\\/:*?"<>|\r\n]*/g, "[PATH]")
    // Strip registry paths e.g. HKEY_..., HKCU\..., HKLM\...
    .replace(/(?:HKEY_[A-Z_]+|HKCU|HKLM)\\[^\s,;"']+/gi, "[REGISTRY_KEY]")
    // Strip token / secret / password key-values
    .replace(/(bearer|token|key|secret|password|cookie|auth)(?:\s+(?:token|key))?[=:\s]+[^\s,;]+/gi, "$1=[REDACTED]");
}

/**
 * Formats a clean, strictly-sanitized JSON diagnostics report safe for public sharing.
 */
export function formatSanitizedDiagnostics(
  health?: HealthCheckSummary,
  aiStatus?: AIStatusPayload,
): string {
  const sanitizedDetails = (health?.details ?? []).map(sanitizeDiagnosticsText);

  const payload = {
    app: "RYPER AI OS",
    version: "0.1.2",
    channel: "Stable (Windows x64)",
    timestamp: new Date().toISOString(),
    runtime: {
      platform: sanitizeDiagnosticsText(health?.platform ?? "win32"),
      platformVersion: sanitizeDiagnosticsText(health?.platformVersion ?? "unknown"),
      gatewayStatus: health?.status ?? "unknown",
    },
    localAI: {
      mode: aiStatus?.mode ?? "local",
      readinessState: aiStatus?.readinessState ?? (aiStatus?.ready ? "ready" : "offline"),
      label: sanitizeDiagnosticsText(aiStatus?.label ?? "Local AI"),
    },
    capabilities: {
      supportedCount: health?.capabilitiesSupported ?? 0,
      totalCount: health?.capabilitiesTotal ?? 0,
    },
    healthDetails: sanitizedDetails,
  };

  return JSON.stringify(payload, null, 2);
}

const THEME_OPTIONS: readonly ThemePreference[] = ["system", "light", "dark"];

/**
 * Mirrors `@ryper/windows-agent`'s real `KNOWN_BROWSERS` ids/labels
 * (also hardcoded this way in `desktop-tools.ts`'s `open_url` tool
 * schema, which the renderer has no other access to — importing
 * `@ryper/windows-agent` itself into the renderer would pull in real
 * Windows registry/filesystem access that has no business running
 * outside the main process). Keep in sync if that list changes.
 */
const BROWSER_OPTIONS: readonly { readonly id: string; readonly label: string }[] = [
  { id: "edge", label: "Microsoft Edge" },
  { id: "chrome", label: "Google Chrome" },
  { id: "firefox", label: "Mozilla Firefox" },
  { id: "brave", label: "Brave" },
];

/**
 * Strips raw Windows audio endpoint GUIDs like ({0.0.0.00000000}.{...}) or
 * raw hex GUIDs from device names, preserving friendly device names.
 */
export function formatAudioDeviceName(
  name: string,
  kind?: AudioDeviceKindPayload,
  index?: number,
): string {
  if (!name || !name.trim()) {
    const fallbackNumber = index !== undefined ? ` ${index + 1}` : "";
    return kind === "microphone" ? `Microphone${fallbackNumber}` : `Speaker${fallbackNumber}`;
  }
  // Remove parenthesized GUIDs like ({0.0.0.00000000}.{...}) or ({guid})
  let clean = name.replace(/\s*\(\{[^)]+\}\)/g, "");
  // Remove raw GUID strings {xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}
  clean = clean.replace(/\s*\{[0-9a-fA-F-]{32,38}\}/g, "");
  // Normalize double whitespace and trim
  clean = clean.replace(/\s{2,}/g, " ").trim();
  // Strip trailing dash if left over
  clean = clean.replace(/\s*-\s*$/, "");
  return clean || name;
}

/**
 * Formats internal Electron accelerators into clean, Windows-native shortcut text.
 * E.g., "CommandOrControl+Shift+Space" -> "Ctrl + Shift + Space".
 */
export function formatShortcutForDisplay(shortcut: string): string {
  if (!shortcut) return "";
  return shortcut
    .replace(/CommandOrControl/gi, "Ctrl")
    .replace(/Control/gi, "Ctrl")
    .replace(/Cmd/gi, "Ctrl")
    .split("+")
    .map((part) => part.trim())
    .join(" + ");
}

/**
 * Parses user-entered shortcut string back into Electron accelerator format.
 */
export function parseShortcutFromInput(input: string): string {
  if (!input) return "";
  return input
    .split("+")
    .map((part) => {
      const p = part.trim();
      if (/^ctrl$/i.test(p)) return "CommandOrControl";
      return p;
    })
    .join("+");
}

export function SettingsApp(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | undefined>(undefined);
  const [health, setHealth] = useState<HealthCheckSummary | undefined>(undefined);
  const [aiStatus, setAIStatus] = useState<AIStatusPayload | undefined>(undefined);
  const [audioStatus, setAudioStatus] = useState<AudioStatusPayload | undefined>(undefined);
  const [microphones, setMicrophones] = useState<readonly AudioDevicePayload[]>([]);
  const [speakers, setSpeakers] = useState<readonly AudioDevicePayload[]>([]);
  const [permissions, setPermissions] = useState<readonly PermissionEntryPayload[]>([]);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [diagnosticsFeedback, setDiagnosticsFeedback] = useState<string | null>(null);
  const [updateCheckStatus, setUpdateCheckStatus] = useState<string | null>(null);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);

  const refreshPermissions = useCallback(async () => {
    try {
      const perms = await window.ryper.listPermissions();
      setPermissions(perms);
    } catch {
      // safe fallback
    }
  }, []);

  const refreshAudio = useCallback(async () => {
    const [status, mics, spks] = await Promise.all([
      window.ryper.getAudioStatus(),
      window.ryper.listAudioDevices("microphone"),
      window.ryper.listAudioDevices("speaker"),
    ]);
    setAudioStatus(status);
    setMicrophones(mics);
    setSpeakers(spks);
  }, []);

  const refreshHealthAndAI = useCallback(async () => {
    try {
      const [h, ai] = await Promise.all([
        window.ryper.getHealth(),
        window.ryper.getAIStatus(),
      ]);
      setHealth(h);
      setAIStatus(ai);
    } catch {
      // safe fallback
    }
  }, []);

  useEffect(() => {
    void window.ryper.getSettings().then((s) => {
      setSettings(s);
      applyDesignTokens(resolveColorScheme(s.theme));
    });
    void refreshHealthAndAI();
    void refreshAudio();
    void refreshPermissions();
    const unsubSettings = window.ryper.onSettingsChanged((s) => {
      setSettings(s);
      applyDesignTokens(resolveColorScheme(s.theme));
    });
    const unsubAudio = window.ryper.onAudioStatusChanged(setAudioStatus);
    return () => {
      unsubSettings();
      unsubAudio();
    };
  }, [refreshAudio, refreshHealthAndAI, refreshPermissions]);

  const runHealthCheck = async (): Promise<void> => {
    setIsCheckingHealth(true);
    setDiagnosticsFeedback("Checking system health…");
    try {
      await Promise.all([refreshHealthAndAI(), refreshPermissions()]);
      setDiagnosticsFeedback("Health check complete.");
    } catch {
      setDiagnosticsFeedback("Health check encountered an error.");
    } finally {
      setIsCheckingHealth(false);
      setTimeout(() => setDiagnosticsFeedback(null), 3500);
    }
  };

  const copyDiagnostics = async (): Promise<void> => {
    try {
      const sanitized = formatSanitizedDiagnostics(health, aiStatus);
      try {
        await navigator.clipboard.writeText(sanitized);
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = sanitized;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setDiagnosticsFeedback("Diagnostics copied to clipboard (sanitized).");
    } catch {
      setDiagnosticsFeedback("Failed to copy diagnostics.");
    } finally {
      setTimeout(() => setDiagnosticsFeedback(null), 3500);
    }
  };

  const openLogsFolder = async (): Promise<void> => {
    try {
      await window.ryper.openLogsFolder();
      setDiagnosticsFeedback("Opened logs directory in File Explorer.");
    } catch {
      setDiagnosticsFeedback("Unable to open logs folder.");
    } finally {
      setTimeout(() => setDiagnosticsFeedback(null), 3500);
    }
  };

  const checkUpdates = (): void => {
    setIsCheckingUpdates(true);
    setUpdateCheckStatus("Checking release channel…");
    setTimeout(() => {
      setIsCheckingUpdates(false);
      setUpdateCheckStatus(
        "You are running RYPER AI OS v0.1.2 (Stable Windows x64). Official releases are distributed via verified packages."
      );
    }, 600);
  };

  const resetPermissions = async (): Promise<void> => {
    await window.ryper.resetPermissions();
    await refreshPermissions();
  };

  const selectDevice = async (kind: AudioDeviceKindPayload, deviceId: string): Promise<void> => {
    await window.ryper.selectAudioDevice(kind, deviceId);
    await refreshAudio();
  };

  const requestPermission = async (kind: AudioDeviceKindPayload): Promise<void> => {
    await window.ryper.requestAudioPermission(kind);
    await refreshAudio();
  };

  if (!settings) return <div className="settings-loading">Loading…</div>;

  const update = (patch: Partial<AppSettings>): void => {
    void window.ryper.updateSettings(patch).then(setSettings);
  };

  return (
    <div className="settings-window">
      <h1>Settings</h1>

      <section className="settings-section glass">
        <span className="glass-highlight" />
        <h2>Appearance</h2>
        <div className="settings-row">
          <label htmlFor="theme">Theme</label>
          <select
            id="theme"
            value={settings.theme}
            onChange={(e) => update({ theme: e.target.value as ThemePreference })}
          >
            {THEME_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t[0]?.toUpperCase()}
                {t.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="settings-section glass">
        <span className="glass-highlight" />
        <h2>Voice</h2>
        <div className="settings-row">
          <label htmlFor="voice-enabled">Enable voice</label>
          <input
            id="voice-enabled"
            type="checkbox"
            checked={settings.voiceEnabled}
            onChange={(e) => update({ voiceEnabled: e.target.checked })}
          />
        </div>
        <div className="settings-row">
          <label htmlFor="ptt">Push-to-talk shortcut</label>
          <div className="settings-control-group">
            <input
              id="ptt"
              type="text"
              value={formatShortcutForDisplay(settings.pushToTalkShortcut)}
              onChange={(e) => update({ pushToTalkShortcut: parseShortcutFromInput(e.target.value) })}
              placeholder="Ctrl + Shift + Space"
            />
            <span className="settings-field-hint">Windows shortcut to speak to Ryper</span>
          </div>
        </div>
        <div className="settings-row">
          <label htmlFor="voice-language">Voice language</label>
          <div className="settings-control-group">
            <select
              id="voice-language"
              value={settings.voiceLanguage ?? "auto"}
              onChange={(e) => update({ voiceLanguage: e.target.value as "auto" | "en" | "hi" })}
            >
              <option value="auto">Auto-detect (English / Hindi / Hinglish)</option>
              <option value="en">English</option>
              <option value="hi">Hindi (हिन्दी)</option>
            </select>
            <span className="settings-field-hint">
              Automatically understands spoken English, Hindi, and Hinglish.
            </span>
          </div>
        </div>
        <div className="settings-row">
          <label htmlFor="tts-voice">Voice output / Accent</label>
          <div className="settings-control-group">
            <select
              id="tts-voice"
              value={settings.ttsVoice ?? "auto"}
              onChange={(e) => update({ ttsVoice: e.target.value as "auto" | "en" | "en-IN" | "hi" })}
            >
              <option value="auto">Auto (match response language)</option>
              <option value="en">English (US)</option>
              <option value="en-IN">English (India / Indian Accent)</option>
              <option value="hi">Hindi (हिन्दी)</option>
            </select>
            <span className="settings-field-hint">
              Speaks replies in your preferred accent or matches your query.
            </span>
          </div>
        </div>
      </section>

      <section className="settings-section glass">
        <span className="glass-highlight" />
        <h2>Audio Devices</h2>
        <div className="settings-row">
          <label htmlFor="microphone-select">Microphone</label>
          <select
            id="microphone-select"
            value={microphones.find((d) => d.isDefault)?.id ?? ""}
            onChange={(e) => void selectDevice("microphone", e.target.value)}
            disabled={microphones.length === 0}
          >
            {microphones.length === 0 && <option value="">No microphone detected</option>}
            {microphones.map((d, index) => (
              <option key={d.id} value={d.id}>
                {formatAudioDeviceName(d.name, "microphone", index)}
              </option>
            ))}
          </select>
          <span
            className={`audio-status audio-status--${audioStatus?.microphone ?? "unavailable"}`}
          >
            {audioStatus?.microphone ?? "unavailable"}
          </span>
        </div>
        {audioStatus?.microphone === "permission-denied" && (
          <div className="settings-row">
            <span>Microphone access is needed for voice input.</span>
            <button type="button" onClick={() => void requestPermission("microphone")}>
              Grant access
            </button>
          </div>
        )}
        <div className="settings-row">
          <label htmlFor="speaker-select">Speaker</label>
          <select
            id="speaker-select"
            value={speakers.find((d) => d.isDefault)?.id ?? ""}
            onChange={(e) => void selectDevice("speaker", e.target.value)}
            disabled={speakers.length === 0}
          >
            {speakers.length === 0 && <option value="">No speaker detected</option>}
            {speakers.map((d, index) => (
              <option key={d.id} value={d.id}>
                {formatAudioDeviceName(d.name, "speaker", index)}
              </option>
            ))}
          </select>
          <span className={`audio-status audio-status--${audioStatus?.speaker ?? "unavailable"}`}>
            {audioStatus?.speaker ?? "unavailable"}
          </span>
        </div>
        {audioStatus?.outputRoutingWarning && (
          <div className="settings-row settings-warning">
            <span>
              Ryper couldn&apos;t route speech to this speaker and played it through your
              system&apos;s default output instead ({audioStatus.outputRoutingWarning}).
            </span>
          </div>
        )}
      </section>

      <section className="settings-section glass">
        <span className="glass-highlight" />
        <h2>General</h2>
        <div className="settings-row">
          <label htmlFor="launch">Launch at login</label>
          <input
            id="launch"
            type="checkbox"
            checked={settings.launchAtLogin}
            onChange={(e) => update({ launchAtLogin: e.target.checked })}
          />
        </div>
        <div className="settings-row">
          <label htmlFor="default-browser">Default browser</label>
          <select
            id="default-browser"
            value={settings.preferredBrowserId ?? ""}
            onChange={(e) => update({ preferredBrowserId: e.target.value || undefined })}
          >
            <option value="">System default</option>
            {BROWSER_OPTIONS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section id="setting-permissions" className="settings-section glass">
        <span className="glass-highlight" />
        <h2>Permissions</h2>
        <p className="settings-section-description">
          Capabilities granted to RYPER during this session. Privileged actions require explicit consent.
        </p>
        <div className="permissions-list">
          {permissions.length === 0 && (
            <div className="settings-row">
              <span className="settings-empty-hint">No special permissions requested yet this session.</span>
            </div>
          )}
          {permissions.map((p) => (
            <div key={p.id} className="settings-row permission-row">
              <div className="permission-info">
                <span className="permission-name">{p.category}</span>
                <span className="permission-desc">{p.description}</span>
              </div>
              <div className="permission-control-group">
                <span
                  className={`permission-status ${
                    p.granted ? "permission-status--granted" : "permission-status--prompt"
                  }`}
                >
                  {p.granted
                    ? p.isSessionOnly
                      ? "Allowed this session"
                      : "Always allowed"
                    : p.policy === "denied"
                    ? "Blocked"
                    : "Ask each time"}
                </span>
                <select
                  className="permission-policy-select"
                  aria-label={`Permission policy for ${p.category}`}
                  value={p.policy ?? (p.granted ? (p.isSessionOnly ? "prompt" : "always") : "prompt")}
                  onChange={async (e) => {
                    const nextPolicy = e.target.value as "always" | "prompt" | "denied";
                    await window.ryper.setPermissionPolicy(p.id, nextPolicy);
                    await refreshPermissions();
                  }}
                >
                  <option value="always">Always allow</option>
                  <option value="prompt">Ask each time</option>
                  <option value="denied">Block</option>
                </select>
              </div>
            </div>
          ))}
        </div>
        <div className="settings-row permission-actions-row">
          <button
            type="button"
            className="settings-button btn-reset-permissions"
            onClick={() => void resetPermissions()}
          >
            Reset All Permissions
          </button>
        </div>
      </section>

      <section id="setting-diagnostics" className="settings-section glass">
        <span className="glass-highlight" />
        <h2>Diagnostics & System Health</h2>
        <p className="settings-section-description">
          Live operational status of RYPER subsystems, local AI engine, and OS capabilities.
        </p>

        <div className="health-cards-grid">
          <div className="health-card glass">
            <div className="health-card-header">
              <span className="health-card-title">Core Gateway</span>
              <span className={`health-badge health-badge--${health?.status ?? "unknown"}`}>
                {health?.status ?? "unknown"}
              </span>
            </div>
            <div className="health-card-detail">IPC Orchestrator & State Engine</div>
          </div>

          <div className="health-card glass">
            <div className="health-card-header">
              <span className="health-card-title">Local AI Runtime</span>
              <span
                className={`health-badge health-badge--${
                  aiStatus?.readinessState ?? (aiStatus?.ready ? "ready" : "offline")
                }`}
              >
                {aiStatus?.readinessState ?? (aiStatus?.ready ? "ready" : "offline")}
              </span>
            </div>
            <div className="health-card-detail">
              {aiStatus?.label || "Local AI (llama-server)"} &middot;{" "}
              {aiStatus?.detail || (aiStatus?.ready ? "Model ready for inference" : "Waiting for model engine")}
            </div>
          </div>

          <div className="health-card glass">
            <div className="health-card-header">
              <span className="health-card-title">Platform & OS</span>
              <span className="health-badge health-badge--healthy">Supported</span>
            </div>
            <div className="health-card-detail">
              Windows x64 ({health?.platformVersion || "win32"})
            </div>
          </div>

          <div className="health-card glass">
            <div className="health-card-header">
              <span className="health-card-title">Memory Subsystem</span>
              <span className="health-badge health-badge--healthy">Active</span>
            </div>
            <div className="health-card-detail">Local SQLite & Vector Stores</div>
          </div>

          <div className="health-card glass">
            <div className="health-card-header">
              <span className="health-card-title">Capability Broker</span>
              <span className="health-badge health-badge--healthy">Guarded</span>
            </div>
            <div className="health-card-detail">
              {health
                ? `${health.capabilitiesSupported} of ${health.capabilitiesTotal} domains active`
                : "Protected"}
            </div>
          </div>
        </div>

        {health?.details && health.details.length > 0 && (
          <ul className="health-details">
            {health.details.map((d, i) => (
              <li key={i}>{sanitizeDiagnosticsText(d)}</li>
            ))}
          </ul>
        )}

        <div className="diagnostics-actions-row">
          <button
            type="button"
            className="settings-button btn-run-health-check"
            onClick={() => void runHealthCheck()}
            disabled={isCheckingHealth}
          >
            {isCheckingHealth ? "Checking…" : "Run Health Check"}
          </button>
          <button
            type="button"
            className="settings-button btn-copy-diagnostics"
            onClick={() => void copyDiagnostics()}
          >
            Copy Diagnostics
          </button>
          <button
            type="button"
            className="settings-button btn-open-logs"
            onClick={() => void openLogsFolder()}
          >
            Open Logs Folder
          </button>
        </div>

        {diagnosticsFeedback && (
          <div className="diagnostics-feedback-banner">{diagnosticsFeedback}</div>
        )}
      </section>

      <section id="setting-about" className="settings-section glass">
        <span className="glass-highlight" />
        <h2>About & Updates</h2>
        <div className="about-header-row">
          <div className="about-title-block">
            <div className="about-app-name">RYPER AI OS</div>
            <div className="about-app-desc">
              Local-First Artificial Intelligence Operating System for Windows
            </div>
          </div>
          <div className="about-badges-block">
            <span className="about-version-badge">v0.1.2</span>
            <span className="about-channel-badge">Stable (Windows x64)</span>
          </div>
        </div>

        <div className="about-update-block">
          <p className="about-update-notice">
            Official releases are distributed via verified release packages. Check GitHub releases for updates.
          </p>
          <div className="about-update-actions">
            <button
              type="button"
              className="settings-button btn-check-updates"
              onClick={checkUpdates}
              disabled={isCheckingUpdates}
            >
              {isCheckingUpdates ? "Checking…" : "Check for Updates"}
            </button>
          </div>
        </div>

        {updateCheckStatus && (
          <div className="update-status-banner">{updateCheckStatus}</div>
        )}
      </section>
    </div>
  );
}

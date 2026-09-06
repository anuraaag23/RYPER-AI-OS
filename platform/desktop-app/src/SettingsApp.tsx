import { useCallback, useEffect, useState } from "react";
import type {
  AppSettings,
  AudioDeviceKindPayload,
  AudioDevicePayload,
  AudioStatusPayload,
  HealthCheckSummary,
  ThemePreference,
} from "../electron/ipc-contract.js";
import { applyDesignTokens, resolveColorScheme } from "./lib/apply-tokens.js";

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

export function SettingsApp(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | undefined>(undefined);
  const [health, setHealth] = useState<HealthCheckSummary | undefined>(undefined);
  const [audioStatus, setAudioStatus] = useState<AudioStatusPayload | undefined>(undefined);
  const [microphones, setMicrophones] = useState<readonly AudioDevicePayload[]>([]);
  const [speakers, setSpeakers] = useState<readonly AudioDevicePayload[]>([]);

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

  useEffect(() => {
    void window.ryper.getSettings().then((s) => {
      setSettings(s);
      applyDesignTokens(resolveColorScheme(s.theme));
    });
    void window.ryper.getHealth().then(setHealth);
    void refreshAudio();
    const unsubSettings = window.ryper.onSettingsChanged((s) => {
      setSettings(s);
      applyDesignTokens(resolveColorScheme(s.theme));
    });
    const unsubAudio = window.ryper.onAudioStatusChanged(setAudioStatus);
    return () => {
      unsubSettings();
      unsubAudio();
    };
  }, [refreshAudio]);

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
          <input
            id="ptt"
            type="text"
            value={settings.pushToTalkShortcut}
            onChange={(e) => update({ pushToTalkShortcut: e.target.value })}
          />
        </div>
        <div className="settings-row">
          <label htmlFor="voice-language">Voice language</label>
          <select
            id="voice-language"
            value={settings.voiceLanguage ?? "auto"}
            onChange={(e) => update({ voiceLanguage: e.target.value as "auto" | "en" | "hi" })}
          >
            <option value="auto">Auto-detect (Multilingual / English / Hindi)</option>
            <option value="en">English</option>
            <option value="hi">Hindi (हिन्दी)</option>
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor="tts-voice">Voice output / Accent</label>
          <select
            id="tts-voice"
            value={settings.ttsVoice ?? "auto"}
            onChange={(e) => update({ ttsVoice: e.target.value as "auto" | "en" | "hi" })}
          >
            <option value="auto">Auto (match response language)</option>
            <option value="en">English (US)</option>
            <option value="hi">Hindi (Indian accent / हिन्दी)</option>
          </select>
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
            {microphones.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
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
            {speakers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
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

      <section className="settings-section glass">
        <span className="glass-highlight" />
        <h2>Diagnostics</h2>
        {health ? (
          <>
            <div className="settings-row">
              <span>Status</span>
              <span className={`health-status health-status--${health.status}`}>
                {health.status}
              </span>
            </div>
            <div className="settings-row">
              <span>Platform</span>
              <span>
                {health.platform} ({health.platformVersion})
              </span>
            </div>
            {health.details.length > 0 && (
              <ul className="health-details">
                {health.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p>Loading diagnostics…</p>
        )}
      </section>
    </div>
  );
}

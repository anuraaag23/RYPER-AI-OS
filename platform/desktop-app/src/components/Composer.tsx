import { useEffect, useState, type KeyboardEvent } from "react";
import type { AudioStatusPayload } from "../../electron/ipc-contract.js";
import { useVoiceState } from "../hooks/useRyperData.js";

export interface ComposerProps {
  readonly onSend: (content: string) => void;
  readonly disabled: boolean;
  readonly initialValue?: string;
}

const MIC_LABEL = {
  idle: "Start voice command",
  active: "Stop voice command",
} as const;

/**
 * A real, honest status line for the microphone control — sourced only
 * from an actual `requestAudioPermission()` outcome or a genuine
 * `onAudioStatusChanged()` push from the existing audio bridge (see
 * `electron/ipc-handlers.ts`'s `computeAudioStatus`), never a
 * fabricated recording/transcript state. `listening`/`thinking`/
 * `speaking` themselves are already announced by `VoiceOrb`'s own
 * caption; this only surfaces the cases where voice genuinely cannot
 * proceed from here.
 */
function describeMicIssue(
  micError: string | undefined,
  audioStatus: AudioStatusPayload | undefined,
): string | undefined {
  if (micError) return micError;
  if (audioStatus?.microphone === "unavailable") return "No microphone is available.";
  if (audioStatus?.microphone === "permission-denied") return "Microphone access is off.";
  return undefined;
}

export function Composer({ onSend, disabled, initialValue }: ComposerProps): JSX.Element {
  const [value, setValue] = useState(initialValue ?? "");
  const { status: voiceStatus } = useVoiceState();
  const [audioStatus, setAudioStatus] = useState<AudioStatusPayload | undefined>(undefined);
  const [micError, setMicError] = useState<string | undefined>(undefined);

  // Same real audio-bridge push `Settings`/main.ts already broadcast on
  // device/permission changes (`audio:status-changed`) — no polling,
  // no independent audio state of its own.
  useEffect(() => window.ryper.onAudioStatusChanged(setAudioStatus), []);

  // A stale permission/device error from a previous attempt shouldn't
  // keep showing once a real turn has actually started.
  useEffect(() => {
    if (voiceStatus !== "idle") setMicError(undefined);
  }, [voiceStatus]);

  const submit = (): void => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const active = voiceStatus !== "idle";

  const onMicClick = (): void => {
    if (disabled) return;

    // An in-progress turn (listening, thinking, or speaking) is stopped
    // through the same real `stopVoiceTurn()` the orb uses — no second
    // cancellation path.
    if (active) {
      void window.ryper.stopVoiceTurn();
      return;
    }

    setMicError(undefined);

    if (audioStatus?.microphone === "unavailable") {
      setMicError("No microphone is available.");
      return;
    }

    void (async () => {
      try {
        const granted = await window.ryper.requestAudioPermission("microphone");
        if (!granted) {
          setMicError("Microphone permission was denied.");
          return;
        }
        await window.ryper.startVoiceTurn();
      } catch (err) {
        setMicError(err instanceof Error ? err.message : "Couldn't start the voice command.");
      }
    })();
  };

  const micIssue = describeMicIssue(micError, audioStatus);

  return (
    <div className="composer-wrap">
      <div className="composer glass">
        <span className="glass-highlight" />
        <textarea
          className="composer-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message Ryper…"
          aria-label="Message"
          rows={1}
          disabled={disabled}
        />
        <button
          type="button"
          className={`composer-mic composer-mic--${voiceStatus}`}
          onClick={onMicClick}
          disabled={disabled}
          aria-pressed={active}
          aria-label={active ? MIC_LABEL.active : MIC_LABEL.idle}
        >
          <svg
            className="composer-mic-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 0 0-7 0v5A3.5 3.5 0 0 0 12 15Z" />
            <path d="M6.5 11.5a.75.75 0 0 0-1.5 0 7 7 0 0 0 6.25 6.96V21a.75.75 0 0 0 1.5 0v-2.54a7 7 0 0 0 6.25-6.96.75.75 0 0 0-1.5 0 5.5 5.5 0 0 1-11 0Z" />
          </svg>
        </button>
        <button
          type="button"
          className="composer-send"
          onClick={submit}
          disabled={disabled || value.trim().length === 0}
        >
          Send
        </button>
      </div>
      {micIssue && (
        <div className="composer-mic-status" role="status" aria-live="polite">
          {micIssue}
        </div>
      )}
    </div>
  );
}

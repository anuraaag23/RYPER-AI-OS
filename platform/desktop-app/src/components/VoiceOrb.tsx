import { useEffect, useMemo, useState } from "react";
import { buildVoiceOrbViewModel, type VoiceOrbState } from "@ryper/components";
import type { AudioAvailability, ConnectionStatus } from "../../electron/ipc-contract.js";

export interface VoiceOrbProps {
  readonly state: VoiceOrbState;
  readonly connection?: ConnectionStatus;
  readonly micStatus?: AudioAvailability;
  readonly onPress: () => void;
}

const STATE_LABEL: Record<VoiceOrbState, string> = {
  idle: "Tap to talk",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

const CONNECTION_LABEL: Partial<Record<ConnectionStatus, string>> = {
  degraded: "Reconnecting…",
};

/**
 * Real, animated (spring-eased CSS, not a static icon) voice indicator
 * driven by `@ryper/components`' `buildVoiceOrbViewModel` — the
 * platform-agnostic view-model every shell is meant to render. This is
 * a genuine, working state machine (idle/listening/thinking/speaking,
 * plus a `connection` overlay for error/offline, kept separate from
 * `VoiceOrbState` per `docs/adr/0014` — see that ADR's note on not
 * widening `@ryper/components`' public API unnecessarily). It is not a
 * WebGL fluid-refraction simulation — see `docs/PROJECT_STATE.md`'s
 * known gaps for that honestly-deferred piece of the brief's "physics-
 * based... refraction" voice orb ask.
 */
export function VoiceOrb({ state, connection, micStatus, onPress }: VoiceOrbProps): JSX.Element {
  const viewModel = useMemo(() => buildVoiceOrbViewModel(state), [state]);
  const [pulsePhase, setPulsePhase] = useState(0);

  useEffect(() => {
    if (!viewModel.pulse) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number): void => {
      setPulsePhase(((now - start) / 1000) % 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [viewModel.pulse]);

  const scale = viewModel.pulse ? 1 + Math.sin(pulsePhase * Math.PI * 2) * 0.06 : 1;

  let currentLabel: string;
  let tooltip: string;

  if (viewModel.state !== "idle") {
    currentLabel = STATE_LABEL[viewModel.state];
    tooltip = currentLabel;
  } else if (micStatus === "unavailable") {
    currentLabel = "Microphone unavailable";
    tooltip = "Microphone unavailable — please connect a microphone";
  } else if (micStatus === "permission-denied") {
    currentLabel = "Microphone access is off";
    tooltip = "Microphone access is off — grant microphone permission in Settings";
  } else if (connection === "degraded") {
    currentLabel = CONNECTION_LABEL.degraded ?? "Reconnecting…";
    tooltip = currentLabel;
  } else {
    currentLabel = STATE_LABEL.idle;
    tooltip = "Tap to talk (Ctrl + Shift + Space)";
  }

  return (
    <div className="voice-orb-wrap" role="group" aria-label="Voice assistant">
      <button
        type="button"
        className={`voice-orb voice-orb--${viewModel.state} glass glass--assistant`}
        style={{ transform: `scale(${scale})` }}
        onClick={onPress}
        aria-pressed={viewModel.state !== "idle"}
        aria-label={currentLabel}
        title={tooltip}
      >
        <span className="glass-highlight" />
        <span className="voice-orb-core" />
      </button>
      {/* `aria-live` so state transitions (idle → listening → thinking →
          speaking, or a connection drop) are announced to screen reader
          users even without moving focus back to the orb button. */}
      <div className="voice-orb-caption" aria-live="polite">
        <span>{currentLabel}</span>
      </div>
    </div>
  );
}

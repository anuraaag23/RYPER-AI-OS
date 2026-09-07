import { useEffect, useState } from "react";
import type { StartupDiagnostics } from "../../electron/ipc-contract.js";

/**
 * Formats internal developer startup step descriptions into friendly, human-readable labels.
 * Removes developer acronyms like "VAD, STT/TTS, session, commands, memory".
 */
export function formatStartupStep(step: string): string {
  if (!step) return "";
  if (/voice pipeline/i.test(step)) {
    return "Voice recognition & speech synthesis";
  }
  if (/core services/i.test(step)) {
    return "Core system services";
  }
  if (/security.*capability/i.test(step)) {
    return "Security & permissions system";
  }
  if (/windows platform agent/i.test(step)) {
    return "Windows desktop integration";
  }
  if (/conversation history/i.test(step)) {
    return "Chat history";
  }
  if (/settings/i.test(step)) {
    return "User settings";
  }
  if (/local AI runtime/i.test(step)) {
    return "Local AI engine";
  }
  return step.replace(/\s*\([^)]*\)/g, "").trim();
}

export function SplashOverlay({ visible }: { readonly visible: boolean }): JSX.Element | null {
  const [events, setEvents] = useState<readonly StartupDiagnostics[]>([]);

  useEffect(
    () => window.ryper.onStartupDiagnostics((event) => setEvents((prev) => [...prev, event])),
    [],
  );

  if (!visible) return null;

  return (
    <div className="splash">
      <div className="splash-orb" />
      <div className="splash-title">Starting Ryper…</div>
      <ul className="splash-steps">
        {events.map((event, index) => (
          <li key={index} className={event.ok ? "splash-step-ok" : "splash-step-fail"}>
            {event.ok ? "✓" : "✗"} {formatStartupStep(event.step)}
            {event.detail ? ` — ${event.detail}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

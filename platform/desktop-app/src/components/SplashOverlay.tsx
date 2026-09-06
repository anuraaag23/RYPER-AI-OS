import { useEffect, useState } from "react";
import type { StartupDiagnostics } from "../../electron/ipc-contract.js";

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
            {event.ok ? "✓" : "✗"} {event.step}
            {event.detail ? ` — ${event.detail}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ConfirmationRequestPayload } from "../../electron/ipc-contract.js";

/**
 * Real UI for `confirmation-bridge.ts`'s main<->renderer round trip
 * (docs/adr/0032). Every request the main process pushes here gets a
 * genuine modal with an actual person's decision sent back — there is
 * no default "just approve" path; closing the window/app while a
 * request is pending resolves it as denied on the main side (the
 * bridge's own timeout), never as approved.
 *
 * Keyboard/screen-reader operable (Tier 1 UI brief section N —
 * previously this had no focus management at all, meaning a keyboard
 * or screen-reader user could tab straight past a real, potentially
 * destructive power-confirmation prompt without ever landing on it):
 * focus moves to the Deny button the moment a request appears (the
 * safe default for a destructive action), Tab/Shift+Tab are trapped
 * between the two real buttons so focus can't silently leave to
 * background UI, and Escape denies — matching the same "cancel is the
 * safe default" principle as the Deny button itself.
 */
export function ConfirmationDialog(): JSX.Element | null {
  const [pending, setPending] = useState<ConfirmationRequestPayload | undefined>(undefined);
  const dialogRef = useRef<HTMLDivElement>(null);
  const denyRef = useRef<HTMLButtonElement>(null);

  useEffect(
    () =>
      window.ryper.onConfirmationRequested((request) => {
        setPending(request);
      }),
    [],
  );

  useEffect(() => {
    if (pending) denyRef.current?.focus();
  }, [pending]);

  if (!pending) return null;

  const respond = (approved: boolean): void => {
    void window.ryper.respondToConfirmation(pending.id, approved);
    setPending(undefined);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      respond(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLButtonElement>("button");
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div className="confirmation-overlay" role="presentation">
      <div
        ref={dialogRef}
        className="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        aria-describedby="confirmation-message"
        onKeyDown={onKeyDown}
      >
        <div id="confirmation-title" className="confirmation-title">
          {pending.title}
        </div>
        <div id="confirmation-message" className="confirmation-message">
          {pending.message}
        </div>
        <div className="confirmation-actions">
          <button
            ref={denyRef}
            type="button"
            className="confirmation-deny"
            onClick={() => respond(false)}
          >
            Deny
          </button>
          <button type="button" className="confirmation-approve" onClick={() => respond(true)}>
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

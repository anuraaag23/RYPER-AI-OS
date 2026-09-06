import type { IpcMain, WebContents } from "electron";
import { createLogger } from "@ryper/logging";
import { IPC_CHANNELS, type ConfirmationRequestPayload } from "./ipc-contract.js";

const log = createLogger("desktop-app:confirmation-bridge");

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Closes the most-repeated honest limitation across
 * docs/adr/0021, 0030, and 0031: `CapabilityBroker`'s `consentPrompt`
 * and `@ryper/windows-agent`'s `DestructiveActionGate` confirmer both
 * previously had no real UI to ask through — `main.ts` passed a
 * literal `async () => false` for the former, and `createWindowsAdapter()`
 * was never given the latter at all (silently defaulting to
 * deny-everything). This is the real main<->renderer round trip that
 * backs both: a request is pushed to the renderer, which shows a real
 * modal and sends back the person's actual decision.
 *
 * Mirrors the existing audio-bridge pattern (`audio-bridge.ts`) —
 * `getRendererWebContents` is re-read on every call rather than
 * captured once, so this keeps working correctly across window
 * recreation, and a destroyed/missing window fails safely (denies)
 * rather than hanging forever.
 */
export interface ConfirmationBridge {
  /** Shows a real confirmation dialog and resolves to the user's actual decision — `false` if no renderer is available, or if the person doesn't respond within the timeout. */
  prompt(title: string, message: string): Promise<boolean>;
}

export function createConfirmationBridge(
  ipcMain: IpcMain,
  getRendererWebContents: () => WebContents | undefined,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): ConfirmationBridge {
  const pending = new Map<string, (approved: boolean) => void>();

  ipcMain.handle(
    IPC_CHANNELS.respondToConfirmation,
    (_event: Electron.IpcMainInvokeEvent, id: string, approved: boolean) => {
      const resolve = pending.get(id);
      if (!resolve) {
        // Already resolved (timed out, or a duplicate/stale response) —
        // real, expected race, not an error; see PART 3's "duplicate
        // confirmation"/"stale confirmation" handling.
        log.info("confirmation response for an already-resolved or unknown request", { id });
        return;
      }
      pending.delete(id);
      resolve(approved);
    },
  );

  async function prompt(title: string, message: string): Promise<boolean> {
    const webContents = getRendererWebContents();
    if (!webContents || webContents.isDestroyed()) {
      log.warn("no live renderer to show a confirmation dialog; denying by default", { title });
      return false;
    }

    const id = `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        log.warn("confirmation request timed out with no response; denying by default", {
          id,
          title,
        });
        resolve(false);
      }, timeoutMs);

      pending.set(id, (approved) => {
        clearTimeout(timeout);
        resolve(approved);
      });

      const payload: ConfirmationRequestPayload = { id, title, message };
      webContents.send(IPC_CHANNELS.confirmationRequested, payload);
    });
  }

  return { prompt };
}

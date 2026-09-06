import type { WindowsSystemApi } from "./windows-system-api.js";
import type { ClipboardContent, Unsubscribe, WindowsEventHandler } from "./types.js";

/**
 * The brief's CLIPBOARD section: read/write, history (where available —
 * see `version-detector.ts`), and monitoring (subscribing to
 * `clipboard_changed` system events).
 */
export class ClipboardManager {
  constructor(private readonly systemApi: WindowsSystemApi) {}

  read(): Promise<ClipboardContent | undefined> {
    return this.systemApi.readClipboard();
  }

  async write(content: Omit<ClipboardContent, "capturedAt">): Promise<void> {
    await this.systemApi.writeClipboard({ ...content, capturedAt: new Date().toISOString() });
  }

  history(): Promise<readonly ClipboardContent[]> {
    return this.systemApi.getClipboardHistory();
  }

  /** Calls `onChange` whenever the clipboard's contents change; returns an unsubscribe function. */
  monitor(onChange: (content: ClipboardContent) => void): Unsubscribe {
    const handler: WindowsEventHandler = (event) => {
      if (event.type !== "clipboard_changed") return;
      void this.read().then((content) => {
        if (content) onChange(content);
      });
    };
    return this.systemApi.subscribeToEvents(handler);
  }
}

export function createClipboardManager(systemApi: WindowsSystemApi): ClipboardManager {
  return new ClipboardManager(systemApi);
}

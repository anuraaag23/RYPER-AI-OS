import { describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "../electron/ipc-contract.js";
import { createConfirmationBridge } from "../electron/confirmation-bridge.js";

/**
 * `IpcMain`/`WebContents` are Electron runtime types this sandbox
 * can't instantiate for real — these fakes implement exactly the two
 * methods `confirmation-bridge.ts` actually calls
 * (`ipcMain.handle`, `webContents.send`/`isDestroyed`), which is the
 * real contract being tested; nothing about the bridge's own logic
 * (timeout handling, duplicate-response safety, "no renderer"
 * fail-safe) is faked.
 */
class FakeIpcMain {
  private handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, handler);
  }

  /** Test helper simulating the renderer calling `ipcRenderer.invoke(channel, ...args)`. */
  async invokeFromRenderer(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`no handler registered for "${channel}"`);
    return handler({}, ...args);
  }
}

class FakeWebContents {
  public sent: { channel: string; payload: unknown }[] = [];
  private destroyed = false;

  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload });
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

describe("ConfirmationBridge — real main<->renderer round trip (docs/adr/0032)", () => {
  it("resolves true when the renderer genuinely approves", async () => {
    const ipcMain = new FakeIpcMain();
    const webContents = new FakeWebContents();
    const bridge = createConfirmationBridge(ipcMain as never, () => webContents as never);

    const promptPromise = bridge.prompt("Confirm: shutdown", "this will power off the machine");

    expect(webContents.sent).toHaveLength(1);
    expect(webContents.sent[0]?.channel).toBe(IPC_CHANNELS.confirmationRequested);
    const request = webContents.sent[0]?.payload as { id: string };
    expect(request.id).toBeTruthy();

    await ipcMain.invokeFromRenderer(IPC_CHANNELS.respondToConfirmation, request.id, true);
    await expect(promptPromise).resolves.toBe(true);
  });

  it("resolves false when the renderer genuinely denies", async () => {
    const ipcMain = new FakeIpcMain();
    const webContents = new FakeWebContents();
    const bridge = createConfirmationBridge(ipcMain as never, () => webContents as never);

    const promptPromise = bridge.prompt("Confirm: delete", "delete report.docx");
    const request = webContents.sent[0]?.payload as { id: string };
    await ipcMain.invokeFromRenderer(IPC_CHANNELS.respondToConfirmation, request.id, false);

    await expect(promptPromise).resolves.toBe(false);
  });

  it("denies by default when no renderer is available — never hangs, never approves silently", async () => {
    const ipcMain = new FakeIpcMain();
    const bridge = createConfirmationBridge(ipcMain as never, () => undefined);

    await expect(bridge.prompt("Confirm: restart", "restart now")).resolves.toBe(false);
  });

  it("denies by default when the renderer's WebContents has been destroyed", async () => {
    const ipcMain = new FakeIpcMain();
    const webContents = new FakeWebContents();
    webContents.destroy();
    const bridge = createConfirmationBridge(ipcMain as never, () => webContents as never);

    await expect(bridge.prompt("Confirm: sleep", "sleep now")).resolves.toBe(false);
    expect(webContents.sent).toHaveLength(0); // never even tried to send to a dead renderer
  });

  it("denies on timeout rather than hanging forever when the renderer never responds", async () => {
    vi.useFakeTimers();
    try {
      const ipcMain = new FakeIpcMain();
      const webContents = new FakeWebContents();
      const bridge = createConfirmationBridge(ipcMain as never, () => webContents as never, 5_000);

      const promptPromise = bridge.prompt("Confirm: shutdown", "no one is answering");
      vi.advanceTimersByTime(5_001);

      await expect(promptPromise).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a stale/duplicate response for an already-resolved request is a real no-op, not an error", async () => {
    const ipcMain = new FakeIpcMain();
    const webContents = new FakeWebContents();
    const bridge = createConfirmationBridge(ipcMain as never, () => webContents as never);

    const promptPromise = bridge.prompt("Confirm: delete", "delete once");
    const request = webContents.sent[0]?.payload as { id: string };
    await ipcMain.invokeFromRenderer(IPC_CHANNELS.respondToConfirmation, request.id, true);
    await expect(promptPromise).resolves.toBe(true);

    // A second response for the same, already-resolved id must not throw
    // and must not do anything observable (PART 3's "stale confirmation").
    await expect(
      ipcMain.invokeFromRenderer(IPC_CHANNELS.respondToConfirmation, request.id, false),
    ).resolves.toBeUndefined();
  });

  it("two concurrent prompts each get their own real, independent request id and resolution", async () => {
    const ipcMain = new FakeIpcMain();
    const webContents = new FakeWebContents();
    const bridge = createConfirmationBridge(ipcMain as never, () => webContents as never);

    const first = bridge.prompt("Confirm: shutdown", "first request");
    const second = bridge.prompt("Confirm: restart", "second request");
    expect(webContents.sent).toHaveLength(2);

    const [firstId, secondId] = webContents.sent.map((s) => (s.payload as { id: string }).id);
    expect(firstId).not.toBe(secondId);

    await ipcMain.invokeFromRenderer(IPC_CHANNELS.respondToConfirmation, secondId, false);
    await ipcMain.invokeFromRenderer(IPC_CHANNELS.respondToConfirmation, firstId, true);

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
  });
});

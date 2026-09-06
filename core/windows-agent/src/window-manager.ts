import { createLogger } from "@ryper/logging";
import type { WindowsSystemApi } from "./windows-system-api.js";
import type { WindowInfo, WindowSnapPosition, WindowState } from "./types.js";

const log = createLogger("windows-agent:window-manager");

/**
 * Everything the brief's WINDOW MANAGEMENT section asks for: move,
 * resize, snap, center, focus, metadata reads, active-window detection,
 * and monitor placement (via `WindowInfo.monitorId`/`WindowInfo.bounds`).
 */
export class WindowManager {
  constructor(private readonly systemApi: WindowsSystemApi) {}

  list(): Promise<readonly WindowInfo[]> {
    return this.systemApi.listWindows();
  }

  getActive(): Promise<WindowInfo | undefined> {
    return this.systemApi.getActiveWindow();
  }

  async get(handle: string): Promise<WindowInfo | undefined> {
    const windows = await this.systemApi.listWindows();
    return windows.find((w) => w.handle === handle);
  }

  async focus(handle: string): Promise<void> {
    await this.systemApi.focusWindow(handle);
    log.info("window focused", { handle });
  }

  async setState(handle: string, state: WindowState): Promise<void> {
    await this.systemApi.setWindowState(handle, state);
  }

  minimize(handle: string): Promise<void> {
    return this.setState(handle, "minimized");
  }

  maximize(handle: string): Promise<void> {
    return this.setState(handle, "maximized");
  }

  restore(handle: string): Promise<void> {
    return this.setState(handle, "normal");
  }

  async move(handle: string, x: number, y: number): Promise<void> {
    await this.systemApi.moveWindow(handle, x, y);
  }

  async resize(handle: string, width: number, height: number): Promise<void> {
    if (width <= 0 || height <= 0) {
      throw new Error("window width and height must be positive");
    }
    await this.systemApi.resizeWindow(handle, width, height);
  }

  async snap(handle: string, position: WindowSnapPosition): Promise<void> {
    await this.systemApi.snapWindow(handle, position);
    log.info("window snapped", { handle, position });
  }

  async center(handle: string): Promise<void> {
    await this.systemApi.centerWindow(handle);
  }

  /** Switches focus to the next window belonging to a different app than the currently active one (Alt+Tab-style). */
  async switchToNext(): Promise<WindowInfo | undefined> {
    const [windows, active] = await Promise.all([
      this.systemApi.listWindows(),
      this.systemApi.getActiveWindow(),
    ]);
    if (windows.length === 0) return undefined;
    const activeIndex = active ? windows.findIndex((w) => w.handle === active.handle) : -1;
    const next = windows[(activeIndex + 1) % windows.length];
    if (!next) return undefined;
    await this.focus(next.handle);
    return next;
  }
}

export function createWindowManager(systemApi: WindowsSystemApi): WindowManager {
  return new WindowManager(systemApi);
}

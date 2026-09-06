import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, Menu, Tray, type BrowserWindow, nativeImage } from "electron";
import { createLogger } from "@ryper/logging";

const log = createLogger("desktop-app:tray");
const __dirname = fileURLToPath(new URL(".", import.meta.url));

export interface TrayCallbacks {
  readonly toggleMainWindow: () => void;
  readonly openSettings: () => void;
  readonly setVoiceEnabled: (enabled: boolean) => void;
  readonly startPushToTalk: () => void;
  readonly stopPushToTalk: () => void;
  readonly isVoiceEnabled: () => boolean;
}

export interface TrayStatusInfo {
  readonly created: boolean;
  readonly tooltip: string;
  readonly visible: boolean;
  readonly destroyed: boolean;
}

const FALLBACK_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAZElEQVQ4T2NkoBAwUqifYdQAGhuAMYzVQIChGfT/PwMDIwMDEz6DGRhGDRj2BiBljP///2dgYmJk+P//PwMTAwMDEy6DoRr+oxtAcgxGDaDXBvDYwMDAyMCIbAAjAwMDAxMDg6EBAH+hExFq1Kx9AAAAAElFTkSuQmCC";

let activeTray: Tray | undefined;
let currentTooltip = "Ryper";

function loadTrayIcon(): Electron.NativeImage {
  const iconPath = join(__dirname, "..", "assets", "tray-icon.png");
  const fromFile = nativeImage.createFromPath(iconPath);
  if (!fromFile.isEmpty()) return fromFile;
  return nativeImage.createFromDataURL(FALLBACK_ICON_DATA_URL);
}

export function getActiveTray(): Tray | undefined {
  return activeTray;
}

export function getTrayStatus(): TrayStatusInfo {
  const isCreated = Boolean(activeTray && !activeTray.isDestroyed());
  return {
    created: isCreated,
    tooltip: currentTooltip,
    visible: isCreated,
    destroyed: !isCreated,
  };
}

export function setTrayTooltip(tooltip: string): void {
  if (!tooltip || tooltip.trim().length === 0) {
    throw new Error("tray tooltip cannot be empty");
  }
  if (tooltip.length > 128) {
    throw new Error("tray tooltip exceeds maximum allowed length (128 characters)");
  }
  currentTooltip = tooltip.trim();
  if (activeTray && !activeTray.isDestroyed()) {
    activeTray.setToolTip(currentTooltip);
  }
  log.info("tray tooltip updated", { tooltip: currentTooltip });
}

export function destroyTray(): void {
  if (activeTray && !activeTray.isDestroyed()) {
    try {
      activeTray.destroy();
    } catch (err) {
      log.warn("error destroying tray", { error: String(err) });
    }
  }
  activeTray = undefined;
  log.info("tray destroyed cleanly");
}

export function createTray(mainWindow: BrowserWindow, callbacks: TrayCallbacks): Tray {
  // Guard against duplicate instance leak on re-initialization
  if (activeTray && !activeTray.isDestroyed()) {
    log.info("destroying existing tray instance before recreating");
    destroyTray();
  }

  const tray = new Tray(loadTrayIcon());
  currentTooltip = "Ryper";
  tray.setToolTip(currentTooltip);

  const rebuildMenu = (): void => {
    const voiceEnabled = callbacks.isVoiceEnabled();
    const menu = Menu.buildFromTemplate([
      {
        label: mainWindow.isVisible() ? "Hide Ryper" : "Show Ryper",
        click: callbacks.toggleMainWindow,
      },
      { type: "separator" },
      {
        label: "Push to Talk",
        click: () => {
          callbacks.startPushToTalk();
          setTimeout(callbacks.stopPushToTalk, 3000);
        },
        enabled: voiceEnabled,
      },
      {
        label: voiceEnabled ? "Disable Voice" : "Enable Voice",
        click: () => {
          callbacks.setVoiceEnabled(!voiceEnabled);
          rebuildMenu();
        },
      },
      { type: "separator" },
      { label: "Settings…", click: callbacks.openSettings },
      { type: "separator" },
      { label: "Quit Ryper", click: () => app.quit() },
    ]);
    tray.setContextMenu(menu);
  };

  rebuildMenu();
  tray.on("click", callbacks.toggleMainWindow);
  activeTray = tray;
  log.info("tray initialized");
  return tray;
}

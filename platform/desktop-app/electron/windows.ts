import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, session, shell } from "electron";
import { createLogger } from "@ryper/logging";

const log = createLogger("desktop-app:windows");

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// In production, `dist-renderer/{main,settings}.html` are built by Vite (see vite.config.ts's
// rollupOptions.input) sitting alongside this compiled `dist-electron/windows.js`'s parent dir.
const RENDERER_DIR = join(__dirname, "..", "dist-renderer");
const isDev = process.env["RYPER_DESKTOP_DEV"] === "1";
const DEV_SERVER_URL = process.env["RYPER_DESKTOP_DEV_URL"] ?? "http://localhost:5273";

function preloadPath(): string {
  return join(__dirname, "preload.cjs");
}

let mediaPermissionsConfigured = false;

/**
 * Electron denies every permission request (including `getUserMedia()`)
 * by default unless a handler explicitly grants it — real, deliberate
 * Electron security behavior, not something this repo weakens. Phase
 * 13.6's real audio bridge needs `"media"` (microphone) granted; every
 * other permission (geolocation, notifications, camera, etc.) stays
 * denied, matching this repo's "never grant silently" default (see
 * `main.ts`'s `denyAllConfirmer` for the equivalent capability-broker
 * policy, `docs/adr/0017`).
 */
function configureMediaPermissions(): void {
  if (mediaPermissionsConfigured) return;
  mediaPermissionsConfigured = true;
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });
  ses.setPermissionCheckHandler((_webContents, permission) => permission === "media");
}

export function configureWindowSecurity(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        void shell.openExternal(url);
      }
    } catch {
      // ignore invalid URL
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (isDev && url.startsWith(DEV_SERVER_URL)) {
      return;
    }
    // Prevent renderer navigation away from the local application bundle
    event.preventDefault();
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        void shell.openExternal(url);
      }
    } catch {
      // ignore invalid URL
    }
  });
}

const APP_ICON_PATH = join(
  __dirname,
  "..",
  "assets",
  process.platform === "win32" ? "icon.ico" : "icon.png",
);

export function createMainWindow(): BrowserWindow {
  configureMediaPermissions();
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 560,
    show: false,
    icon: APP_ICON_PATH,
    backgroundColor: "#00000000",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  configureWindowSecurity(win);

  if (isDev) {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    void win.loadFile(join(RENDERER_DIR, "index.html"));
  }

  win.once("ready-to-show", () => {
    win.show();
    log.info("main window shown");
  });

  return win;
}

export function createSettingsWindow(parent?: BrowserWindow): BrowserWindow {
  const win = new BrowserWindow({
    width: 640,
    height: 520,
    minimizable: false,
    maximizable: false,
    resizable: false,
    show: false,
    icon: APP_ICON_PATH,
    ...(parent ? { parent, modal: process.platform !== "darwin" } : {}),
    backgroundColor: "#00000000",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  configureWindowSecurity(win);

  if (isDev) {
    void win.loadURL(`${DEV_SERVER_URL}/settings.html`);
  } else {
    void win.loadFile(join(RENDERER_DIR, "settings.html"));
  }

  win.once("ready-to-show", () => {
    win.show();
    log.info("settings window shown");
  });

  return win;
}


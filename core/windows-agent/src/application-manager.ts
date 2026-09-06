import { createLogger } from "@ryper/logging";
import type { WindowsSystemApi } from "./windows-system-api.js";
import type { AppInfo, ProcessInfo } from "./types.js";
import type { BrowserResolver } from "./browser-resolver.js";
import { KNOWN_BROWSERS, BrowserNotInstalledError } from "./browser-resolver.js";

const log = createLogger("windows-agent:application-manager");

/**
 * The brief's APPLICATION CONTROL section: launch/close/restart
 * installed applications, enumerate them, and open URLs/files via the
 * OS-registered default handler. `browserResolver` is optional purely
 * for backward compatibility with any existing caller constructing
 * this class directly without one — `WindowsAdapter` always supplies a
 * real one (see docs/adr/0030); without it, `openUrl(url, browserId)`
 * can still open the *default* browser (`browserId` omitted) but
 * cannot honor an explicit browser request.
 */
export class ApplicationManager {
  constructor(
    private readonly systemApi: WindowsSystemApi,
    private readonly browserResolver?: BrowserResolver,
  ) {}

  listInstalled(): Promise<readonly AppInfo[]> {
    return this.systemApi.listInstalledApplications();
  }

  listRunning(): Promise<readonly AppInfo[]> {
    return this.systemApi.listRunningApplications();
  }

  async launch(appId: string, args?: readonly string[]): Promise<ProcessInfo> {
    const process = await this.systemApi.launchApplication(appId, args);
    log.info("application launched", { appId, pid: process.pid });
    return process;
  }

  async close(appId: string): Promise<void> {
    await this.systemApi.closeApplication(appId);
    log.info("application closed", { appId });
  }

  async restart(appId: string): Promise<ProcessInfo> {
    await this.close(appId);
    return this.launch(appId);
  }

  /**
   * `browserId` is a *known browser id* (`"chrome"`, `"edge"`,
   * `"firefox"`, `"brave"` — see `resolveBrowserId()` for turning
   * free-text into one of these), not a browser display name or an
   * `AppInfo.appId` — the caller (a tool's `execute()`, typically) is
   * responsible for that resolution. Omitting `browserId` opens the URL
   * in the system default browser (unchanged, pre-existing behavior).
   * When `browserId` is given and that browser genuinely isn't
   * installed, this throws `BrowserNotInstalledError` rather than
   * silently opening a different browser — the exact behavior PART 3
   * of the universal-open brief requires.
   */
  async openUrl(url: string, browserId?: string): Promise<void> {
    if (!browserId) {
      await this.systemApi.openUrl(url);
      log.info("URL opened in default browser", { url });
      return;
    }
    const browser = KNOWN_BROWSERS.find((b) => b.id === browserId);
    if (!browser) throw new Error(`unknown browser id "${browserId}"`);
    if (!this.browserResolver) {
      throw new BrowserNotInstalledError(browser);
    }
    const executablePath = await this.browserResolver.locate(browserId);
    if (!executablePath) throw new BrowserNotInstalledError(browser);
    await this.systemApi.startProcess(executablePath, [url]);
    log.info("URL opened in explicitly requested browser", { url, browser: browser.id });
  }

  /** Real, currently-installed browsers this PC can explicitly open a URL in — lets a tool tell a user which named browsers are actually available. */
  async listBrowsers(): Promise<readonly { readonly id: string; readonly displayName: string }[]> {
    if (!this.browserResolver) return [];
    const results: { id: string; displayName: string }[] = [];
    for (const browser of KNOWN_BROWSERS) {
      const path = await this.browserResolver.locate(browser.id);
      if (path) results.push({ id: browser.id, displayName: browser.displayName });
    }
    return results;
  }

  /** "Open Chrome" with no target site — genuinely different from `openUrl(url, browserId)`, which always needs a real URL to hand the browser. Launches the resolved browser's own executable with no arguments, same as double-clicking its icon. */
  async launchBrowser(browserId: string): Promise<void> {
    const browser = KNOWN_BROWSERS.find((b) => b.id === browserId);
    if (!browser) throw new Error(`unknown browser id "${browserId}"`);
    if (!this.browserResolver) throw new BrowserNotInstalledError(browser);
    const executablePath = await this.browserResolver.locate(browserId);
    if (!executablePath) throw new BrowserNotInstalledError(browser);
    await this.systemApi.startProcess(executablePath, []);
    log.info("browser launched with no target URL", { browser: browser.id });
  }

  async openFile(path: string): Promise<void> {
    await this.systemApi.openFile(path);
    log.info("file opened with its associated application", { path });
  }

  async openFolder(path: string): Promise<void> {
    await this.systemApi.openFolder(path);
    log.info("folder opened in Explorer", { path });
  }
}

export function createApplicationManager(
  systemApi: WindowsSystemApi,
  browserResolver?: BrowserResolver,
): ApplicationManager {
  return new ApplicationManager(systemApi, browserResolver);
}

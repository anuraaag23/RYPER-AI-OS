import { createLogger } from "@ryper/logging";
import type { WindowsSystemApi } from "./windows-system-api.js";

const log = createLogger("windows-agent:browser-resolver");

/**
 * The universal-open capability (see `docs/adr/0030`) needs to
 * distinguish real, individually-named browsers rather than mapping
 * every spoken browser name onto whichever one happens to be
 * installed. Before this file existed, `resolveAppId()` in the desktop
 * app's `desktop-actions.ts` mapped `"chrome"` straight to
 * `"microsoft.edge"` — silently launching the wrong browser for any
 * request that named Chrome explicitly. That mapping is now gone.
 */
export interface BrowserDescriptor {
  readonly id: string;
  readonly displayName: string;
  /** The real executable filename Windows' "App Paths" registry key and Program Files installs use. */
  readonly executableName: string;
  /** Free-text aliases a spoken/typed request might use to name this browser. */
  readonly aliases: readonly string[];
  /** Realistic, non-exhaustive Windows install locations, checked as a last-resort fallback after registry/installed-app lookups. Supports both architectures and a common per-user (no-admin) install path. */
  readonly candidatePaths: readonly string[];
}

export const KNOWN_BROWSERS: readonly BrowserDescriptor[] = [
  {
    id: "edge",
    displayName: "Microsoft Edge",
    executableName: "msedge.exe",
    aliases: ["edge", "microsoft edge", "msedge"],
    candidatePaths: [
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ],
  },
  {
    id: "chrome",
    displayName: "Google Chrome",
    executableName: "chrome.exe",
    aliases: ["chrome", "google chrome"],
    candidatePaths: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe",
    ],
  },
  {
    id: "firefox",
    displayName: "Mozilla Firefox",
    executableName: "firefox.exe",
    aliases: ["firefox", "mozilla firefox", "mozilla"],
    candidatePaths: [
      "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
      "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe",
    ],
  },
  {
    id: "brave",
    displayName: "Brave",
    executableName: "brave.exe",
    aliases: ["brave", "brave browser"],
    candidatePaths: [
      "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      "C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      "%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    ],
  },
];

/** Free-text ("open this in chrome") -> a known browser id, or `undefined` if the text doesn't name a known browser at all (as opposed to naming one that just isn't installed — see `BrowserResolver.locate`). */
export function resolveBrowserId(spokenName: string): string | undefined {
  const normalized = spokenName.trim().toLowerCase();
  return KNOWN_BROWSERS.find((b) => b.aliases.includes(normalized))?.id;
}

export class BrowserNotInstalledError extends Error {
  constructor(readonly browser: BrowserDescriptor) {
    super(`${browser.displayName} is not installed on this PC.`);
  }
}

/**
 * Real, multi-tier discovery — deliberately not PATH-only (Windows
 * desktop browsers frequently aren't on PATH at all) and deliberately
 * not "assume it's always at the one path my dev machine has it."
 * Tiers, in order, first success wins:
 *
 * 1. `WindowsSystemApi.listInstalledApplications()` — the existing
 *    application-discovery infrastructure this package already has;
 *    matches by name/appId containing the browser's own name.
 * 2. The Windows "App Paths" registry key
 *    (`HKLM\...\App Paths\<exe>`, then `HKCU\...` for a per-user
 *    install) — the real, standard mechanism every major browser
 *    self-registers on install, and the most reliable single source
 *    for "is this exact browser installed and where," independent of
 *    `listInstalledApplications()`'s own real limitations (e.g.
 *    `Get-CimInstance Win32_Product` is well known to miss many
 *    modern MSIX/per-user installs).
 * 3. A fixed list of realistic install locations for both
 *    architectures and the common per-user (no-admin) path, verified
 *    via `listDirectory` on the containing folder — a last resort, not
 *    the primary mechanism, and not something this class hardcodes as
 *    if it were the only possible location.
 *
 * Never falls back to a *different* browser than the one asked for —
 * "not found in any tier" means genuinely not installed, reported as
 * `BrowserNotInstalledError`, never silently substituted.
 */
export class BrowserResolver {
  constructor(private readonly systemApi: WindowsSystemApi) {}

  /** Resolves a known browser id to its real, currently-installed executable path, or `undefined` if genuinely not installed. */
  async locate(browserId: string): Promise<string | undefined> {
    const browser = KNOWN_BROWSERS.find((b) => b.id === browserId);
    if (!browser) return undefined;

    const viaInstalledApps = await this.locateViaInstalledApps(browser);
    if (viaInstalledApps) return viaInstalledApps;

    const viaRegistry = await this.locateViaAppPathsRegistry(browser);
    if (viaRegistry) return viaRegistry;

    const viaCandidatePaths = await this.locateViaCandidatePaths(browser);
    if (viaCandidatePaths) return viaCandidatePaths;

    log.info("browser not found in any discovery tier", { browser: browser.id });
    return undefined;
  }

  private async locateViaInstalledApps(browser: BrowserDescriptor): Promise<string | undefined> {
    try {
      const apps = await this.systemApi.listInstalledApplications();
      const nameNeedle = browser.displayName.toLowerCase();
      const match = apps.find(
        (app) =>
          app.appId.toLowerCase().includes(browser.id) ||
          app.name.toLowerCase().includes(nameNeedle) ||
          app.name.toLowerCase().includes(browser.executableName.replace(".exe", "")),
      );
      return match?.executablePath;
    } catch (err) {
      log.info("listInstalledApplications lookup failed, trying next discovery tier", {
        browser: browser.id,
        error: String(err),
      });
      return undefined;
    }
  }

  private async locateViaAppPathsRegistry(browser: BrowserDescriptor): Promise<string | undefined> {
    const appPathsKey = `SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${browser.executableName}`;
    for (const hive of ["HKLM", "HKCU"] as const) {
      try {
        const value = await this.systemApi.readRegistryValue(hive, appPathsKey, "");
        if (value && typeof value.value === "string" && value.value.length > 0) {
          return value.value;
        }
      } catch (err) {
        // A missing registry key is the expected, common "not installed
        // via this hive" case (some real backends throw rather than
        // return `undefined` for a missing key/value) — not a real
        // error, just move on to the next hive/tier.
        log.info("App Paths registry lookup failed, trying next discovery tier", {
          browser: browser.id,
          hive,
          error: String(err),
        });
      }
    }
    return undefined;
  }

  private async locateViaCandidatePaths(browser: BrowserDescriptor): Promise<string | undefined> {
    for (const rawPath of browser.candidatePaths) {
      // `%LOCALAPPDATA%` is the one environment variable real
      // per-user browser installs actually use here; there is no
      // general-purpose env-var expansion in this package (see
      // `path-resolver.ts`'s honest limitation note) — this is a
      // narrow, deliberate exception for exactly this known case.
      const path = rawPath.includes("%LOCALAPPDATA%")
        ? await this.expandLocalAppData(rawPath)
        : rawPath;
      if (!path) continue;

      const lastSeparator = path.lastIndexOf("\\");
      const dir = path.slice(0, lastSeparator);
      const fileName = path.slice(lastSeparator + 1);
      try {
        const entries = await this.systemApi.listDirectory(dir);
        if (entries.some((e) => e.name.toLowerCase() === fileName.toLowerCase())) {
          return path;
        }
      } catch (err) {
        // The directory not existing is the expected "not installed at
        // this candidate location" case, not a real error.
        log.info("candidate browser path probe failed, trying next candidate", {
          browser: browser.id,
          path,
          error: String(err),
        });
      }
    }
    return undefined;
  }

  private async expandLocalAppData(rawPath: string): Promise<string | undefined> {
    try {
      // There's no direct "%LOCALAPPDATA%" well-known folder, but
      // `getWellKnownFolderPath("desktop")`'s real parent directory
      // (`C:\Users\<user>`) is a stable anchor real Windows profiles
      // share with `AppData\Local`, so it's derived from there rather
      // than a second hardcoded username assumption.
      const desktop = await this.systemApi.getWellKnownFolderPath("desktop");
      const lastSeparator = desktop.lastIndexOf("\\");
      const userProfile = desktop.slice(0, lastSeparator);
      return rawPath.replace("%LOCALAPPDATA%", `${userProfile}\\AppData\\Local`);
    } catch (err) {
      log.info("could not resolve %LOCALAPPDATA% for candidate-path probing", {
        error: String(err),
      });
      return undefined;
    }
  }
}

export function createBrowserResolver(systemApi: WindowsSystemApi): BrowserResolver {
  return new BrowserResolver(systemApi);
}

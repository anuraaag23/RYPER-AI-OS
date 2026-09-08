import type { CapabilityManager } from "@ryper/platform-capability";
import {
  resolveBrowserId,
  stripWrappingQuotes,
  normalizeUrl,
  BrowserNotInstalledError,
} from "@ryper/windows-agent";
import { createLogger } from "@ryper/logging";
import {
  type PowerAction,
  type PowerConfirmationManager,
  POWER_ACTION_PROMPTS,
  POWER_ACTION_SUCCESS_MESSAGES,
  POWER_CONFIRMATION_SESSION_KEY,
} from "./power-confirmation.js";
import type { ContextReferenceTracker } from "./context-reference.js";

/**
 * Free-text spoken/typed app names -> the reference `WindowsAdapter`'s
 * known `appId`s (see `core/windows-agent`'s `defaultInstalledApps`).
 * **Deliberately does not include any browser name.** Before
 * `docs/adr/0030`, this table mapped `chrome: "microsoft.edge"` —
 * silently launching Edge for any request that named Chrome
 * explicitly. Browser names are now resolved separately, through the
 * real, per-browser `BrowserResolver` (see `openApplication` below),
 * which can tell "not installed" apart from "installed" instead of
 * collapsing every browser into whichever one this table happened to
 * list.
 */
const KNOWN_APP_IDS: Readonly<Record<string, string>> = {
  notepad: "microsoft.windows.notepad",
  calculator: "microsoft.windows.calculator",
  calc: "microsoft.windows.calculator",
};

/**
 * A small, fixed, explicit list of well-known website names (same
 * convention as `KNOWN_APP_IDS` above) — not general knowledge, just
 * the specific sites the brief's own examples name ("Open YouTube",
 * "Open Google"). `smart_open`'s real `looksLikeUrl()` classification
 * deliberately stays conservative (a genuine `http(s)://` scheme or a
 * real domain-with-TLD pattern) so it doesn't misclassify an ordinary
 * word as a URL; this table is the one, narrow, reviewable exception
 * for names that are genuinely ambiguous between "an application" and
 * "a website" without a domain-shaped hint.
 */
const KNOWN_WEBSITE_ALIASES: Readonly<Record<string, string>> = {
  youtube: "youtube.com",
  google: "google.com",
  gmail: "mail.google.com",
  github: "github.com",
  amazon: "amazon.com",
  netflix: "netflix.com",
  wikipedia: "wikipedia.org",
  reddit: "reddit.com",
};

/** Peels a trailing "... in <browser>" off free text naming both a target and a browser (e.g. "YouTube in Chrome" -> {target: "YouTube", browser: "chrome"}). Returns the original text with no browser if there's no such suffix. */
function splitTargetAndBrowser(text: string): { target: string; browserId: string | undefined } {
  const match = /^(.*?)\s+in\s+(chrome|edge|firefox|brave)$/i.exec(text.trim());
  if (!match) return { target: text, browserId: undefined };
  return { target: (match[1] ?? "").trim(), browserId: (match[2] ?? "").toLowerCase() };
}

export function hasNullByte(str?: string): boolean {
  return typeof str === "string" && str.includes("\0");
}

export function isProtectedSystemPath(targetPath: string): boolean {
  if (!targetPath) return false;
  if (hasNullByte(targetPath)) return true;
  const normalized = targetPath.replace(/[\/\\]+/g, "\\").trim();
  const lower = normalized.toLowerCase();
  const protectedRoots = [
    "c:\\",
    "c:",
    "c:\\windows",
    "c:\\windows\\system32",
    "c:\\windows\\syswow64",
    "c:\\program files",
    "c:\\program files (x86)",
    "c:\\users",
    "c:\\users\\default",
    "c:\\recovery",
    "c:\\boot",
    "c:\\system volume information",
  ];
  return protectedRoots.some((p) => lower === p || lower === p + "\\");
}

export function resolveAppId(spokenName: string): string | undefined {
  return KNOWN_APP_IDS[spokenName.trim().toLowerCase()];
}

export interface DesktopActionResult {
  readonly ok: boolean;
  readonly message: string;
}

async function invoke(
  capabilityManager: CapabilityManager,
  domain: string,
  operation: string,
  parameters: Record<string, unknown>,
  actorId: string,
  onSuccess: string,
): Promise<DesktopActionResult> {
  try {
    await capabilityManager.invoke(domain, operation, parameters, {
      invocationId: `desktop-action-${Date.now()}`,
      actorId,
      sessionId: actorId,
      platform: "windows",
    });
    return { ok: true, message: onSuccess };
  } catch (err) {
    return {
      ok: false,
      message: `I couldn't do that: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function currentVolume(
  capabilityManager: CapabilityManager,
  actorId: string,
): Promise<number> {
  const result = await capabilityManager.invoke(
    "audio",
    "get_volume",
    {},
    {
      invocationId: `desktop-action-${Date.now()}`,
      actorId,
      sessionId: actorId,
      platform: "windows",
    },
  );
  return typeof result === "number" ? result : 50;
}

/** Shared context builder — every `capabilityManager.invoke()` call in this file uses the same shape. */
function ctx(actorId: string): {
  invocationId: string;
  actorId: string;
  sessionId: string;
  platform: "windows";
} {
  return {
    invocationId: `desktop-action-${Date.now()}`,
    actorId,
    sessionId: actorId,
    platform: "windows",
  };
}

/** The subset of `@ryper/windows-agent`'s real `WindowInfo` these actions actually read. */
interface WindowInfoLite {
  readonly handle: string;
  readonly title: string;
  readonly appId: string;
  readonly state: string;
  readonly focused: boolean;
}

function isWindowInfoLite(value: unknown): value is WindowInfoLite {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["handle"] === "string"
  );
}

async function listWindows(
  capabilityManager: CapabilityManager,
  actorId: string,
): Promise<readonly WindowInfoLite[]> {
  const result = await capabilityManager.invoke("window_management", "enumerate", {}, ctx(actorId));
  return Array.isArray(result) ? result.filter(isWindowInfoLite) : [];
}

/**
 * Voice/text requests name a window by what's on screen ("the Chrome
 * window", "Notepad") — real `WindowInfo.handle`s aren't something a
 * user ever says. Resolves a free-text `query` against real,
 * currently-open windows' titles/`appId`s (case-insensitive substring
 * match); with no query, resolves to whatever window
 * `window_management.get_active` reports is really focused right now.
 */
async function resolveWindow(
  capabilityManager: CapabilityManager,
  actorId: string,
  query: string | undefined,
): Promise<WindowInfoLite | undefined> {
  if (!query?.trim()) {
    const active = await capabilityManager.invoke(
      "window_management",
      "get_active",
      {},
      ctx(actorId),
    );
    return isWindowInfoLite(active) ? active : undefined;
  }
  const q = query.trim().toLowerCase();
  const windows = await listWindows(capabilityManager, actorId);
  return windows.find(
    (w) => w.title.toLowerCase().includes(q) || w.appId.toLowerCase().includes(q),
  );
}

async function invokeOnWindow(
  capabilityManager: CapabilityManager,
  actorId: string,
  operation: string,
  query: string | undefined,
  extraParams: Record<string, unknown>,
  describe: (title: string) => string,
): Promise<DesktopActionResult> {
  const target = await resolveWindow(capabilityManager, actorId, query);
  if (!target) {
    return {
      ok: false,
      message: query
        ? `I couldn't find a window matching "${query}".`
        : "I couldn't tell which window is currently active.",
    };
  }
  return invoke(
    capabilityManager,
    "window_management",
    operation,
    { handle: target.handle, ...extraParams },
    actorId,
    describe(target.title),
  );
}

/**
 * The single, real implementation of every deterministic desktop action
 * this repository can actually back with a capability — `voice-commands.ts`
 * (`VoiceCommandRouter` handlers) and `desktop-tools.ts` (`AIOrchestrator`
 * tool definitions) both call these same functions rather than each
 * re-implementing the same `CapabilityManager.invoke()` calls.
 */
/**
 * PART 1's real two-phase flow, step one: registers a pending
 * confirmation for `action` and returns the real spoken prompt —
 * `power_management` is never invoked here. `PowerConfirmationManager.request()`
 * itself replaces (invalidates) any previous pending confirmation for
 * this session, so asking for a second power action while one is
 * already pending doesn't leave two dangling requests (PART 3).
 */
function requestPowerConfirmation(
  powerConfirmation: PowerConfirmationManager,
  actorId: string,
  action: PowerAction,
): DesktopActionResult {
  // Tracked under a fixed key, not `actorId` — see
  // `POWER_CONFIRMATION_SESSION_KEY`'s doc comment for why (the two
  // real callers of this function use different `actorId`s, but both
  // represent the same one real person).
  void actorId;
  powerConfirmation.request(POWER_CONFIRMATION_SESSION_KEY, action);
  return { ok: true, message: POWER_ACTION_PROMPTS[action] };
}

const log = createLogger("desktop-app:desktop-actions");

export const desktopActions = {
  async listInstalledApplications(
    capabilityManager: CapabilityManager,
    actorId: string,
    query?: string,
  ): Promise<DesktopActionResult> {
    try {
      const result = (await capabilityManager.invoke(
        "application_control",
        "enumerate_installed",
        {},
        ctx(actorId),
      )) as readonly { readonly appId: string; readonly name: string; readonly publisher?: string; readonly version?: string }[];
      const apps = Array.isArray(result) ? result : [];
      if (apps.length === 0) {
        return { ok: true, message: "No installed applications found." };
      }
      let filtered = apps;
      if (query && query.trim() && !/^(?:all|installed|apps|applications)$/i.test(query.trim())) {
        const q = query.trim().toLowerCase();
        filtered = apps.filter(
          (a) =>
            (a.name && a.name.toLowerCase().includes(q)) ||
            (a.appId && a.appId.toLowerCase().includes(q)) ||
            (a.publisher && a.publisher.toLowerCase().includes(q)),
        );
      }
      const count = filtered.length;
      const topList = filtered
        .slice(0, 20)
        .map((a) => (a.publisher ? `${a.name} (${a.publisher})` : a.name))
        .join(", ");
      const more = count > 20 ? ` and ${count - 20} more` : "";
      return {
        ok: true,
        message: `Installed applications (${count} total): ${topList}${more}.`,
      };
    } catch (err) {
      return {
        ok: false,
        message:
          err instanceof Error ? err.message : "I couldn't list the installed applications.",
      };
    }
  },

  async listRunningApplications(
    capabilityManager: CapabilityManager,
    actorId: string,
    query?: string,
  ): Promise<DesktopActionResult> {
    try {
      const result = (await capabilityManager.invoke(
        "application_control",
        "enumerate_running",
        {},
        ctx(actorId),
      )) as readonly { readonly appId: string; readonly name: string; readonly publisher?: string; readonly version?: string }[];
      const apps = Array.isArray(result) ? result : [];
      if (apps.length === 0) {
        return { ok: true, message: "No running applications found." };
      }
      let filtered = apps;
      if (query && query.trim() && !/^(?:all|running|apps|applications)$/i.test(query.trim())) {
        const q = query.trim().toLowerCase();
        filtered = apps.filter(
          (a) =>
            (a.name && a.name.toLowerCase().includes(q)) ||
            (a.appId && a.appId.toLowerCase().includes(q)) ||
            (a.publisher && a.publisher.toLowerCase().includes(q)),
        );
      }
      const count = filtered.length;
      const topList = filtered
        .slice(0, 20)
        .map((a) => (a.publisher ? `${a.name} (${a.publisher})` : a.name))
        .join(", ");
      const more = count > 20 ? ` and ${count - 20} more` : "";
      return {
        ok: true,
        message: `Running applications (${count} total): ${topList}${more}.`,
      };
    } catch (err) {
      return {
        ok: false,
        message:
          err instanceof Error ? err.message : "I couldn't list the running applications.",
      };
    }
  },

  async getSystemInfo(
    capabilityManager: CapabilityManager,
    actorId: string,
  ): Promise<DesktopActionResult> {
    try {
      const info = (await capabilityManager.invoke(
        "device_information",
        "get_system_info",
        {},
        ctx(actorId),
      )) as any;
      if (!info) return { ok: false, message: "System information is unavailable." };

      const ramTotalGB = (info.ram.totalBytes / (1024 * 1024 * 1024)).toFixed(1);
      const ramUsedGB = (info.ram.usedBytes / (1024 * 1024 * 1024)).toFixed(1);
      const storageStr = (info.storage || [])
        .map((s: any) => {
          const tot = (s.totalBytes / (1024 * 1024 * 1024)).toFixed(0);
          const free = (s.freeBytes / (1024 * 1024 * 1024)).toFixed(1);
          return `${s.volume} (${free} GB free of ${tot} GB)`;
        })
        .join(", ");
      const battStr = info.battery
        ? `Battery: ${info.battery.percent}% (${info.battery.charging ? "charging" : "on battery"})`
        : "Battery: None (Desktop AC)";
      const netStr = `Network: ${info.network?.connectionType ?? "connected"} (${info.network?.connected ? "online" : "offline"})`;

      const summary =
        `System Information:\n` +
        `- OS: ${info.windowsVersion?.version ?? "Windows 11"} (Build ${info.windowsVersion?.build ?? ""})\n` +
        `- CPU: ${info.cpu?.model} (${info.cpu?.cores} cores, ${info.cpu?.usagePercent}% load)\n` +
        `- GPU: ${info.gpu?.model}\n` +
        `- Memory (RAM): ${ramUsedGB} GB used of ${ramTotalGB} GB total\n` +
        `- Storage: ${storageStr}\n` +
        `- Power: ${battStr}\n` +
        `- ${netStr}`;

      return { ok: true, message: summary };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "I couldn't retrieve system information.",
      };
    }
  },

  async listDisplays(
    capabilityManager: CapabilityManager,
    actorId: string,
  ): Promise<DesktopActionResult> {
    try {
      const result = (await capabilityManager.invoke(
        "display",
        "list",
        {},
        ctx(actorId),
      )) as any[];
      const displays = Array.isArray(result) ? result : [result].filter(Boolean);
      if (displays.length === 0) {
        return { ok: true, message: "No connected displays found." };
      }
      const list = displays
        .map((d, i) => {
          const res = d.bounds ? `${d.bounds.width}x${d.bounds.height}` : "unknown resolution";
          const prim = d.primary ? " (Primary)" : "";
          const hz = d.refreshHz ? ` @ ${d.refreshHz}Hz` : "";
          return `Display ${i + 1}: ${d.name ?? "Display"} - ${res}${hz}${prim}`;
        })
        .join("\n");
      return { ok: true, message: `Connected displays (${displays.length}):\n${list}` };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "I couldn't list the displays.",
      };
    }
  },

  async listAudioDevices(
    capabilityManager: CapabilityManager,
    actorId: string,
  ): Promise<DesktopActionResult> {
    try {
      const result = (await capabilityManager.invoke(
        "audio",
        "list_devices",
        {},
        ctx(actorId),
      )) as any[];
      const devices = Array.isArray(result) ? result : [result].filter(Boolean);
      if (devices.length === 0) {
        return { ok: true, message: "No audio devices found." };
      }
      const list = devices
        .map((d) => `${d.name}${d.default ? " (Default)" : ""}`)
        .join(", ");
      return { ok: true, message: `Available audio devices (${devices.length}): ${list}.` };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "I couldn't list the audio devices.",
      };
    }
  },

  async listNetworkAdapters(
    capabilityManager: CapabilityManager,
    actorId: string,
  ): Promise<DesktopActionResult> {
    try {
      const result = (await capabilityManager.invoke(
        "device_information",
        "list_network_adapters",
        {},
        ctx(actorId),
      )) as any[];
      const adapters = Array.isArray(result) ? result : [result].filter(Boolean);
      if (adapters.length === 0) {
        return { ok: true, message: "No network adapters found." };
      }
      const list = adapters
        .map((a) => `${a.name} (${a.description}) - ${a.status?.toUpperCase() ?? "UNKNOWN"}${a.speed ? `, ${a.speed}` : ""}`)
        .join("\n");
      return { ok: true, message: `Network adapters (${adapters.length}):\n${list}` };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "I couldn't list the network adapters.",
      };
    }
  },

  async listDevices(
    capabilityManager: CapabilityManager,
    actorId: string,
    query?: string,
  ): Promise<DesktopActionResult> {
    try {
      const result = (await capabilityManager.invoke(
        "device_information",
        "list_devices",
        {},
        ctx(actorId),
      )) as any[];
      const devices = Array.isArray(result) ? result : [result].filter(Boolean);
      if (devices.length === 0) {
        return { ok: true, message: "No hardware devices found." };
      }
      let filtered = devices;
      if (query && query.trim()) {
        const q = query.trim().toLowerCase();
        filtered = devices.filter(
          (d) =>
            (d.name && d.name.toLowerCase().includes(q)) ||
            (d.kind && d.kind.toLowerCase().includes(q)),
        );
      }
      const topList = filtered
        .slice(0, 20)
        .map((d) => `${d.name} (${d.kind})`)
        .join(", ");
      const more = filtered.length > 20 ? ` and ${filtered.length - 20} more` : "";
      return {
        ok: true,
        message: `Hardware devices (${filtered.length} total): ${topList}${more}.`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "I couldn't list hardware devices.",
      };
    }
  },

  async listAvailableBrowsers(
    capabilityManager: CapabilityManager,
    actorId: string,
  ): Promise<DesktopActionResult> {
    try {
      const browsers = (await capabilityManager.invoke(
        "application_control",
        "list_browsers",
        {},
        ctx(actorId),
      )) as readonly { readonly id: string; readonly displayName: string }[];
      if (browsers.length === 0) {
        return { ok: true, message: "I couldn't find any of the browsers I know how to open." };
      }
      return {
        ok: true,
        message: `Installed browsers: ${browsers.map((b) => b.displayName).join(", ")}.`,
      };
    } catch (err) {
      return {
        ok: false,
        message:
          err instanceof Error ? err.message : "I couldn't check which browsers are installed.",
      };
    }
  },

  async launchNamedBrowser(
    capabilityManager: CapabilityManager,
    actorId: string,
    browser: string | undefined,
  ): Promise<DesktopActionResult> {
    if (!browser) return { ok: false, message: "Which browser should I open?" };
    const browserId = resolveBrowserId(browser);
    if (!browserId) return { ok: false, message: `I don't know a browser called "${browser}".` };
    try {
      await capabilityManager.invoke(
        "application_control",
        "launch_browser",
        { browserId },
        ctx(actorId),
      );
      return { ok: true, message: `Opening ${browser}.` };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : `Couldn't open ${browser}.`,
      };
    }
  },

  async openApplication(
    capabilityManager: CapabilityManager,
    actorId: string,
    spokenApp: string | undefined,
    contextTracker?: ContextReferenceTracker,
    preferredBrowser?: string,
  ): Promise<DesktopActionResult> {
    if (!spokenApp) return { ok: false, message: "Which application should I open?" };

    // "Open <app>" is DEFAULT_INTENT_PATTERNS's own greedy `open
    // (?<app>.+)` — it swallows a trailing "in Chrome"-style browser
    // suffix along with everything else, so that's peeled off first
    // regardless of which real target this ends up being.
    const { target: rawTarget, browserId: explicitBrowserId } = splitTargetAndBrowser(spokenApp);

    let target = rawTarget.trim();
    // Conversational repair (Bug 5): handle corrections like "Downloads, not Documents" or "no, open Downloads" or "I said open Downloads"
    const notMatch = /^(?<intended>.+?)(?:,\s*|\s+)not\s+.+$/i.exec(target);
    if (notMatch && notMatch.groups?.intended) {
      target = notMatch.groups.intended.trim();
    }
    const correctionPrefixMatch = /^(?:no,?\s+)?(?:i\s+said\s+)?(?:open\s+)?(?<intended>.+)$/i.exec(target);
    if (correctionPrefixMatch && correctionPrefixMatch.groups?.intended && correctionPrefixMatch.groups.intended.toLowerCase() !== rawTarget.toLowerCase()) {
      target = correctionPrefixMatch.groups.intended.trim();
    }

    // Conversational follow-up (Bug 10): "again" / "open again" / "play again" / "fir se" / "phir se" / "dobara"
    if (/^(?:again|it again|that again|this again|fir se|phir se|dobara)$/i.test(target)) {
      if (!contextTracker) {
        return { ok: false, message: "I don't have a file, folder, or link to open right now." };
      }
      return this.openContextualReference(
        capabilityManager,
        actorId,
        contextTracker,
        preferredBrowser,
      );
    }

    // "Open this"/"open this folder"/"open that PDF" (PART 9-11) — a
    // bare demonstrative, optionally followed by one descriptive word,
    // with no real named target at all. This must be checked *before*
    // anything below tries to treat "this"/"that" as a literal
    // app/browser/website/file name (which would either fail
    // confusingly or, worse, resolve to the wrong thing).
    if (/^(?:this|that)(?:\s+\w+)?$/i.test(target)) {
      if (!contextTracker) {
        return { ok: false, message: "I don't have a file, folder, or link to open right now." };
      }
      return this.openContextualReference(
        capabilityManager,
        actorId,
        contextTracker,
        preferredBrowser,
      );
    }

    const namedBrowserId = explicitBrowserId ?? resolveBrowserId(target);
    if (namedBrowserId && !explicitBrowserId) {
      // "Open Chrome" with no target site — a real, dedicated
      // application-launch, not `open_url`, which always needs a URL.
      try {
        await capabilityManager.invoke(
          "application_control",
          "launch_browser",
          { browserId: namedBrowserId },
          ctx(actorId),
        );
        return { ok: true, message: `Opening ${target}.` };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : `Couldn't open ${target}.`,
        };
      }
    }

    const appId = resolveAppId(target);
    if (appId && !explicitBrowserId) {
      return invoke(
        capabilityManager,
        "application_control",
        "launch",
        { appId },
        actorId,
        `Opening ${target}.`,
      );
    }

    // Real fallback for the brief's own literal examples ("Open
    // YouTube", "Open YouTube in Chrome", "Open https://youtube.com",
    // "Open my Downloads folder", "Open C:\...\file.pdf"): neither a
    // known app nor a known browser standalone. `DEFAULT_INTENT_PATTERNS`'s
    // `open_application` pattern (`/^open (?<app>.+)$/i`) is checked
    // before any `DESKTOP_INTENT_PATTERNS` entry and matches literally
    // any "open ..." phrase, so a dedicated "open_file"/"open_folder"
    // voice pattern could never actually be reached for "open ..."
    // phrasing — this fallback chain inside the one handler that *is*
    // reached is the real, working way to cover all of it, not a
    // workaround:
    //
    // 1. A small, explicit, well-known website-name table (not general
    //    knowledge — just the specific names the brief's own examples
    //    use), resolved straight to `open_url`.
    // 2. Otherwise, the same real, deterministic classification
    //    `smart_open` uses (URL / existing file / existing directory,
    //    verified against the real filesystem, never guessed) — this
    //    is what makes "Open my Downloads folder" and
    //    "Open C:\...\file.pdf" work through this same handler.
    const normalizedTarget = target.toLowerCase();
    const websiteDomain = KNOWN_WEBSITE_ALIASES[normalizedTarget];
    if (websiteDomain) {
      return this.openUrl(
        capabilityManager,
        actorId,
        websiteDomain,
        explicitBrowserId,
        contextTracker,
        preferredBrowser,
      );
    }
    return this.smartOpen(
      capabilityManager,
      actorId,
      target,
      explicitBrowserId,
      contextTracker,
      preferredBrowser,
    );
  },

  async closeApplication(
    capabilityManager: CapabilityManager,
    actorId: string,
    spokenApp: string | undefined,
  ): Promise<DesktopActionResult> {
    const appId = spokenApp ? resolveAppId(spokenApp) : undefined;
    if (!appId) return { ok: false, message: `I don't know how to close "${spokenApp ?? ""}".` };
    return invoke(
      capabilityManager,
      "application_control",
      "close",
      { appId },
      actorId,
      `Closing ${spokenApp}.`,
    );
  },

  async volumeUp(
    capabilityManager: CapabilityManager,
    actorId: string,
  ): Promise<DesktopActionResult> {
    const level = Math.min(100, (await currentVolume(capabilityManager, actorId)) + 10);
    return invoke(capabilityManager, "audio", "set_volume", { level }, actorId, "Volume up.");
  },

  async volumeDown(
    capabilityManager: CapabilityManager,
    actorId: string,
    explicitPercent?: number,
  ): Promise<DesktopActionResult> {
    const level =
      explicitPercent !== undefined
        ? explicitPercent
        : Math.max(0, (await currentVolume(capabilityManager, actorId)) - 10);
    return invoke(capabilityManager, "audio", "set_volume", { level }, actorId, "Volume down.");
  },

  async setVolume(
    capabilityManager: CapabilityManager,
    actorId: string,
    percent: number,
  ): Promise<DesktopActionResult> {
    if (Number.isNaN(percent)) return { ok: false, message: "What volume would you like?" };
    const level = Math.max(0, Math.min(100, percent));
    return invoke(
      capabilityManager,
      "audio",
      "set_volume",
      { level },
      actorId,
      `Volume set to ${level} percent.`,
    );
  },

  async mute(capabilityManager: CapabilityManager, actorId: string): Promise<DesktopActionResult> {
    return invoke(capabilityManager, "audio", "set_mute", { muted: true }, actorId, "Muted.");
  },

  async unmute(
    capabilityManager: CapabilityManager,
    actorId: string,
  ): Promise<DesktopActionResult> {
    return invoke(capabilityManager, "audio", "set_mute", { muted: false }, actorId, "Unmuted.");
  },

  async showNotification(
    capabilityManager: CapabilityManager,
    actorId: string,
    title: string | undefined,
    message: string | undefined,
  ): Promise<DesktopActionResult> {
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return { ok: false, message: "I need both a title and a message to show a notification." };
    }
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return { ok: false, message: "I need both a title and a message to show a notification." };
    }
    if (title.length > 256) {
      return { ok: false, message: "Notification title exceeds maximum allowed length (256 characters)." };
    }
    if (message.length > 2048) {
      return { ok: false, message: "Notification message exceeds maximum allowed length (2048 characters)." };
    }
    if (title.includes("\0") || message.includes("\0")) {
      return { ok: false, message: "Notification contains invalid characters." };
    }
    return invoke(
      capabilityManager,
      "notifications",
      "show",
      { title: title.trim(), body: message.trim(), kind: "basic" },
      actorId,
      `Notification shown: "${title.trim()}".`,
    );
  },

  async listNotifications(
    capabilityManager: CapabilityManager,
    actorId: string,
    limit?: number,
  ): Promise<DesktopActionResult> {
    try {
      const raw = await capabilityManager.invoke("notifications", "list", {}, ctx(actorId));
      const list = Array.isArray(raw) ? raw : [];
      if (list.length === 0) {
        return { ok: true, message: "No notifications recorded in current session." };
      }
      const max = typeof limit === "number" && limit > 0 ? limit : 20;
      const formatted = list
        .slice(-max)
        .reverse()
        .map(
          (n: any) =>
            `[${n.shownAt || "unknown"}] ${n.spec?.title || "Notification"}: ${n.spec?.body || ""}`,
        )
        .join("\n- ");
      return {
        ok: true,
        message: `Recent Notifications (${list.length} total):\n- ${formatted}`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Failed to list notifications.",
      };
    }
  },

  async getTrayStatus(
    capabilityManager: CapabilityManager,
    actorId: string,
  ): Promise<DesktopActionResult> {
    try {
      const status = (await capabilityManager.invoke(
        "system_tray",
        "get_status",
        {},
        ctx(actorId),
      )) as any;
      return {
        ok: true,
        message:
          `System Tray Status:\n` +
          `- Created: ${status?.created ? "Yes" : "No"}\n` +
          `- Tooltip: "${status?.tooltip || "Ryper"}"\n` +
          `- Visible: ${status?.visible ? "Yes" : "No"}`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Failed to get system tray status.",
      };
    }
  },

  async updateTrayTooltip(
    capabilityManager: CapabilityManager,
    actorId: string,
    tooltip: string | undefined,
  ): Promise<DesktopActionResult> {
    if (!tooltip || typeof tooltip !== "string" || tooltip.trim().length === 0) {
      return { ok: false, message: "Tray tooltip text is required." };
    }
    if (tooltip.length > 128) {
      return { ok: false, message: "Tray tooltip exceeds maximum allowed length (128 characters)." };
    }
    return invoke(
      capabilityManager,
      "system_tray",
      "update_tooltip",
      { tooltip: tooltip.trim() },
      actorId,
      `System tray tooltip updated to "${tooltip.trim()}".`,
    );
  },

  async mediaControl(
    capabilityManager: CapabilityManager,
    actorId: string,
    action: "play" | "pause" | "next" | "previous",
  ): Promise<DesktopActionResult> {
    const responses: Record<typeof action, string> = {
      play: "Playing.",
      pause: "Paused.",
      next: "Next track.",
      previous: "Previous track.",
    };
    return invoke(
      capabilityManager,
      "audio",
      "media_control",
      { action },
      actorId,
      responses[action],
    );
  },

  // ---- Process management (real OS process enumeration via `@ryper/windows-agent`) ----

  async listProcesses(
    capabilityManager: CapabilityManager,
    actorId: string,
    query?: string,
  ): Promise<DesktopActionResult> {
    try {
      const result = (await capabilityManager.invoke(
        "process_management",
        "list",
        {},
        ctx(actorId),
      )) as readonly { readonly pid?: number; readonly name?: string; readonly executablePath?: string }[];
      const procs = Array.isArray(result) ? result : [];
      if (procs.length === 0) {
        return { ok: true, message: "No running processes found." };
      }
      let filtered = procs;
      if (query && query.trim()) {
        const q = query.trim().toLowerCase();
        filtered = procs.filter(
          (p) =>
            (typeof p.name === "string" && p.name.toLowerCase().includes(q)) ||
            (p.pid != null && p.pid.toString() === q),
        );
      }
      const count = filtered.length;
      const topList = filtered
        .slice(0, 20)
        .map((p) => `${p.name ?? "unknown"} (PID: ${p.pid ?? "unknown"})`)
        .join(", ");
      const more = count > 20 ? ` and ${count - 20} more` : "";
      return {
        ok: true,
        message: `Running processes (${count} total): ${topList}${more}.`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Failed to list processes.",
      };
    }
  },

  // ---- Window management (real Win32 APIs via `@ryper/windows-agent`'s
  // `WindowManager` — previously implemented with zero AI tool surface;
  // see the Tier 1 completion pass, continued, in docs/PROJECT_STATE.md) ----

  async getWindowInfo(
    capabilityManager: CapabilityManager,
    actorId: string,
    query?: string,
  ): Promise<DesktopActionResult> {
    try {
      const q = query?.trim();
      const isAll = !q || /^(?:all|open|current|windows|everything)$/i.test(q);
      if (!isAll) {
        const target = await resolveWindow(capabilityManager, actorId, q);
        if (!target) {
          return { ok: false, message: `I couldn't find a window matching "${q}".` };
        }
        return {
          ok: true,
          message: `Window "${target.title}": handle=${target.handle}, state=${target.state}, focused=${target.focused}, appId=${target.appId}.`,
        };
      }
      const active = await resolveWindow(capabilityManager, actorId, undefined);
      const all = await listWindows(capabilityManager, actorId);
      if (all.length === 0) {
        return { ok: true, message: "No open windows found." };
      }
      const details = all
        .slice(0, 10)
        .map((w) => `"${w.title}" (handle: ${w.handle}, state: ${w.state}, focused: ${w.focused})`)
        .join("; ");
      const activeDesc = active ? ` Currently focused: "${active.title}".` : "";
      return {
        ok: true,
        message: `Open windows (${all.length} total): ${details}.${activeDesc}`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Failed to get window information.",
      };
    }
  },

  async listWindows(
    capabilityManager: CapabilityManager,
    actorId: string,
  ): Promise<DesktopActionResult> {
    const windows = await listWindows(capabilityManager, actorId);
    if (windows.length === 0) return { ok: true, message: "No windows are currently open." };
    const summary = windows
      .map((w) => `"${w.title}" (${w.state}${w.focused ? ", focused" : ""})`)
      .join("; ");
    return { ok: true, message: `Open windows: ${summary}.` };
  },

  async getActiveWindow(
    capabilityManager: CapabilityManager,
    actorId: string,
  ): Promise<DesktopActionResult> {
    const active = await resolveWindow(capabilityManager, actorId, undefined);
    if (!active) return { ok: true, message: "No window is currently active." };
    return { ok: true, message: `The active window is "${active.title}".` };
  },

  async focusWindow(
    capabilityManager: CapabilityManager,
    actorId: string,
    query: string | undefined,
  ): Promise<DesktopActionResult> {
    if (!query?.trim()) return { ok: false, message: "Which window should I switch to?" };
    return invokeOnWindow(
      capabilityManager,
      actorId,
      "focus",
      query,
      {},
      (title) => `Switched to "${title}".`,
    );
  },

  async minimizeWindow(
    capabilityManager: CapabilityManager,
    actorId: string,
    query: string | undefined,
  ): Promise<DesktopActionResult> {
    return invokeOnWindow(
      capabilityManager,
      actorId,
      "minimize",
      query,
      {},
      (title) => `Minimized "${title}".`,
    );
  },

  async maximizeWindow(
    capabilityManager: CapabilityManager,
    actorId: string,
    query: string | undefined,
  ): Promise<DesktopActionResult> {
    return invokeOnWindow(
      capabilityManager,
      actorId,
      "maximize",
      query,
      {},
      (title) => `Maximized "${title}".`,
    );
  },

  async restoreWindow(
    capabilityManager: CapabilityManager,
    actorId: string,
    query: string | undefined,
  ): Promise<DesktopActionResult> {
    return invokeOnWindow(
      capabilityManager,
      actorId,
      "restore",
      query,
      {},
      (title) => `Restored "${title}".`,
    );
  },

  async snapWindow(
    capabilityManager: CapabilityManager,
    actorId: string,
    position: string | undefined,
    query: string | undefined,
  ): Promise<DesktopActionResult> {
    const validPositions = [
      "left",
      "right",
      "top",
      "bottom",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ];
    if (!position || !validPositions.includes(position)) {
      return { ok: false, message: "Which side of the screen should I snap that window to?" };
    }
    return invokeOnWindow(
      capabilityManager,
      actorId,
      "snap",
      query,
      { position },
      (title) => `Snapped "${title}" to the ${position}.`,
    );
  },

  async switchWindow(
    capabilityManager: CapabilityManager,
    actorId: string,
  ): Promise<DesktopActionResult> {
    return invoke(
      capabilityManager,
      "window_management",
      "switch_active",
      {},
      actorId,
      "Switched windows.",
    );
  },

  // ---- Filesystem (real APIs via `@ryper/windows-agent`'s `FileManager` —
  // previously implemented with zero AI tool surface) ----

  async listFiles(
    capabilityManager: CapabilityManager,
    actorId: string,
    path: string | undefined,
    pattern?: string,
  ): Promise<DesktopActionResult> {
    if (!path) return { ok: false, message: "Which folder should I look in?" };
    try {
      let targetPath = path;
      const normalized = path.trim().toLowerCase().replace(/^(my|the)\s+/, "").replace(/\s+folder$/, "");
      if (["downloads", "desktop", "documents", "pictures", "videos", "music"].includes(normalized)) {
        try {
          const resolved = (await capabilityManager.invoke(
            "filesystem",
            "well_known_folder",
            { folder: normalized },
            ctx(actorId),
          )) as string;
          if (resolved) targetPath = resolved;
        } catch {
          // keep original path
        }
      }
      const params: Record<string, unknown> = { path: targetPath };
      if (pattern) params["filter"] = pattern;
      const rawEntries = await capabilityManager.invoke(
        "filesystem",
        "list",
        params,
        ctx(actorId),
      );
      const entries = (Array.isArray(rawEntries) ? rawEntries : rawEntries ? [rawEntries] : []) as readonly {
        name?: string;
        path?: string;
        kind?: string;
        sizeBytes?: number;
        Name?: string;
        FullName?: string;
        Length?: number | null;
      }[];
      if (entries.length === 0) {
        return { ok: true, message: `"${targetPath}" is empty.` };
      }
      // Sort entries so largest files appear first, ensuring intelligence tools see the largest files even in large folders
      const sortedEntries = [...entries].sort((a, b) => {
        const sizeA = typeof a.sizeBytes === "number" ? a.sizeBytes : typeof a.Length === "number" ? a.Length : 0;
        const sizeB = typeof b.sizeBytes === "number" ? b.sizeBytes : typeof b.Length === "number" ? b.Length : 0;
        return sizeB - sizeA;
      });
      const maxEntries = 50;
      const displayEntries = sortedEntries.slice(0, maxEntries);
      const summary = displayEntries
        .map((e) => {
          const name = e.name ?? e.Name ?? e.path ?? e.FullName ?? "";
          const isDir = e.kind === "directory" || (e.kind == null && e.Length == null && e.sizeBytes == null);
          const size = typeof e.sizeBytes === "number" ? e.sizeBytes : typeof e.Length === "number" ? e.Length : undefined;
          const sizeInfo = size !== undefined && !isDir ? ` (${size} bytes)` : "";
          return `${name}${isDir ? "/" : ""}${sizeInfo}`;
        })
        .join(", ");
      const moreInfo = sortedEntries.length > maxEntries ? ` (...and ${sortedEntries.length - maxEntries} more items)` : "";
      return { ok: true, message: `In "${targetPath}": ${summary}${moreInfo}.` };
    } catch (err) {
      return {
        ok: false,
        message: `I couldn't list that folder: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  async readFile(
    capabilityManager: CapabilityManager,
    actorId: string,
    path: string | undefined,
  ): Promise<DesktopActionResult> {
    if (!path) return { ok: false, message: "Which file should I read?" };
    try {
      const content = (await capabilityManager.invoke(
        "filesystem",
        "read",
        { path },
        ctx(actorId),
      )) as string;
      return { ok: true, message: content };
    } catch (err) {
      return {
        ok: false,
        message: `I couldn't read that file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  async searchFiles(
    capabilityManager: CapabilityManager,
    actorId: string,
    query: string | undefined,
    rootPath: string | undefined,
  ): Promise<DesktopActionResult> {
    if (!query?.trim()) return { ok: false, message: "What should I search for?" };
    try {
      let targetRoot = rootPath;
      if (rootPath) {
        const normalized = rootPath.trim().toLowerCase().replace(/^(my|the)\s+/, "").replace(/\s+folder$/, "");
        if (["downloads", "desktop", "documents", "pictures", "videos", "music"].includes(normalized)) {
          try {
            const resolved = (await capabilityManager.invoke(
              "filesystem",
              "well_known_folder",
              { folder: normalized },
              ctx(actorId),
            )) as string;
            if (resolved) targetRoot = resolved;
          } catch {
            // keep original rootPath
          }
        }
      }
      const params: Record<string, unknown> = { query };
      if (targetRoot) params["rootPath"] = targetRoot;
      const rawResults = await capabilityManager.invoke(
        "filesystem",
        "search",
        params,
        ctx(actorId),
      );
      const results = (Array.isArray(rawResults) ? rawResults : rawResults ? [rawResults] : []) as readonly {
        name?: string;
        path?: string;
        kind?: string;
        sizeBytes?: number;
        Name?: string;
        FullName?: string;
        Length?: number | null;
      }[];
      if (results.length === 0) {
        return { ok: true, message: `No files found matching "${query}".` };
      }
      // Sort matching files by size descending
      const sortedResults = [...results].sort((a, b) => {
        const sizeA = typeof a.sizeBytes === "number" ? a.sizeBytes : typeof a.Length === "number" ? a.Length : 0;
        const sizeB = typeof b.sizeBytes === "number" ? b.sizeBytes : typeof b.Length === "number" ? b.Length : 0;
        return sizeB - sizeA;
      });
      const maxResults = 50;
      const displayResults = sortedResults.slice(0, maxResults);
      const summary = displayResults
        .map((r) => {
          const p = r.path ?? r.FullName ?? r.name ?? r.Name ?? "";
          const isDir = r.kind === "directory" || (r.kind == null && r.Length == null && r.sizeBytes == null);
          const size = typeof r.sizeBytes === "number" ? r.sizeBytes : typeof r.Length === "number" ? r.Length : undefined;
          const sizeInfo = size !== undefined && !isDir ? ` (${size} bytes)` : "";
          return `${p}${sizeInfo}`;
        })
        .join(", ");
      const moreInfo = sortedResults.length > maxResults ? ` (...and ${sortedResults.length - maxResults} more items)` : "";
      return { ok: true, message: `Found: ${summary}${moreInfo}.` };
    } catch (err) {
      return {
        ok: false,
        message: `I couldn't search for that: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  async getFolderPath(
    capabilityManager: CapabilityManager,
    actorId: string,
    folder: string | undefined,
  ): Promise<DesktopActionResult> {
    const known = ["downloads", "desktop", "documents", "pictures", "videos", "music"];
    const normalized = folder?.trim().toLowerCase();
    if (!normalized || !known.includes(normalized)) {
      return { ok: false, message: `I don't recognize the folder "${folder ?? ""}".` };
    }
    try {
      const path = (await capabilityManager.invoke(
        "filesystem",
        "well_known_folder",
        { folder: normalized },
        ctx(actorId),
      )) as string;
      return { ok: true, message: `Your ${normalized} folder is at "${path}".` };
    } catch (err) {
      return {
        ok: false,
        message: `I couldn't find that folder: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  async listRecentFiles(
    capabilityManager: CapabilityManager,
    actorId: string,
  ): Promise<DesktopActionResult> {
    try {
      const results = (await capabilityManager.invoke(
        "filesystem",
        "recent",
        {},
        ctx(actorId),
      )) as readonly { name: string }[];
      if (!Array.isArray(results) || results.length === 0) {
        return { ok: true, message: "No recent files." };
      }
      return { ok: true, message: `Recent files: ${results.map((r) => r.name).join(", ")}.` };
    } catch (err) {
      return {
        ok: false,
        message: `I couldn't get recent files: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  isProtectedPath(targetPath: string): boolean {
    return isProtectedSystemPath(targetPath);
  },

  async createFolder(
    capabilityManager: CapabilityManager,
    actorId: string,
    path: string | undefined,
  ): Promise<DesktopActionResult> {
    if (!path) return { ok: false, message: "What should the new folder's path be?" };
    if (hasNullByte(path)) return { ok: false, message: "Invalid path: null bytes are not permitted." };
    return invoke(
      capabilityManager,
      "filesystem",
      "create_folder",
      { path },
      actorId,
      `Created folder "${path}".`,
    );
  },

  async copyFile(
    capabilityManager: CapabilityManager,
    actorId: string,
    sourcePath: string | undefined,
    destinationPath: string | undefined,
  ): Promise<DesktopActionResult> {
    if (!sourcePath || !destinationPath) {
      return { ok: false, message: "I need both a source and a destination path to copy." };
    }
    if (hasNullByte(sourcePath) || hasNullByte(destinationPath)) {
      return { ok: false, message: "Invalid path: null bytes are not permitted." };
    }
    return invoke(
      capabilityManager,
      "filesystem",
      "copy",
      { sourcePath, destinationPath },
      actorId,
      `Copied "${sourcePath}" to "${destinationPath}".`,
    );
  },

  async moveFile(
    capabilityManager: CapabilityManager,
    actorId: string,
    sourcePath: string | undefined,
    destinationPath: string | undefined,
  ): Promise<DesktopActionResult> {
    if (!sourcePath || !destinationPath) {
      return { ok: false, message: "I need both a source and a destination path to move." };
    }
    if (hasNullByte(sourcePath) || hasNullByte(destinationPath)) {
      return { ok: false, message: "Invalid path: null bytes are not permitted." };
    }
    if (isProtectedSystemPath(sourcePath) || isProtectedSystemPath(destinationPath)) {
      return { ok: false, message: "Access denied: moving to or from a protected system path is blocked." };
    }
    return invoke(
      capabilityManager,
      "filesystem",
      "move",
      { sourcePath, destinationPath },
      actorId,
      `Moved "${sourcePath}" to "${destinationPath}".`,
    );
  },

  async renameFile(
    capabilityManager: CapabilityManager,
    actorId: string,
    path: string | undefined,
    newName: string | undefined,
  ): Promise<DesktopActionResult> {
    if (!path || !newName) {
      return { ok: false, message: "I need both the file and its new name to rename it." };
    }
    if (hasNullByte(path) || hasNullByte(newName)) {
      return { ok: false, message: "Invalid path: null bytes are not permitted." };
    }
    if (isProtectedSystemPath(path)) {
      return { ok: false, message: `Access denied: renaming protected system path "${path}" is blocked.` };
    }
    return invoke(
      capabilityManager,
      "filesystem",
      "rename",
      { path, newName },
      actorId,
      `Renamed "${path}" to "${newName}".`,
    );
  },

  /**
   * Destructive — routes through `FileManager.delete()`'s real
   * `DestructiveActionGate`, which defaults to denying every request
   * unless the platform shell has injected a real, UI-backed confirmer
   * (see `core/windows-agent/src/confirmation.ts`). This tool does not
   * bypass or duplicate that gate; a denial surfaces as a normal failed
   * `ToolResult`, same as any other capability denial.
   */
  async deleteFile(
    capabilityManager: CapabilityManager,
    actorId: string,
    path: string | undefined,
    contextTracker?: ContextReferenceTracker,
  ): Promise<DesktopActionResult> {
    if (!path) return { ok: false, message: "Which file or folder should I delete?" };
    if (hasNullByte(path)) return { ok: false, message: "Invalid path: null bytes are not permitted." };
    if (isProtectedSystemPath(path)) {
      return { ok: false, message: `Access denied: deleting protected system path "${path}" is blocked.` };
    }
    const result = await invoke(
      capabilityManager,
      "filesystem",
      "delete",
      { path },
      actorId,
      `Deleted "${path}".`,
    );
    // PART 11: a reference to something just deleted must not linger to
    // be "opened" successfully-looking-but-actually-real-error later —
    // clearing it here is a real hygiene improvement; the *safety*
    // property (never claiming a deleted file opened) already held
    // regardless, since `openFile`/`openFolder` hit the real filesystem
    // and would fail honestly either way.
    if (result.ok && contextTracker?.get()?.path === path) {
      contextTracker.clear();
    }
    return result;
  },

  // ---- Universal open capability (see docs/adr/0030) ----

  async openUrl(
    capabilityManager: CapabilityManager,
    actorId: string,
    url: string | undefined,
    browser: string | undefined,
    contextTracker?: ContextReferenceTracker,
    /**
     * The user's configured default browser (Settings), not something
     * named in this specific request — only consulted when `browser`
     * is absent. Unlike an explicitly-named browser, if this one isn't
     * actually installed the open still succeeds via the system
     * default rather than failing outright — the user didn't type this
     * browser name themselves, so a stale/uninstalled preference
     * shouldn't block opening the link at all.
     */
    preferredBrowser?: string,
  ): Promise<DesktopActionResult> {
    if (!url) return { ok: false, message: "What should I open?" };
    const normalizedUrl = normalizeUrl(url);

    const isExplicitBrowser = Boolean(browser);
    let browserId: string | undefined;
    let browserLabel: string | undefined;
    if (browser) {
      browserId = resolveBrowserId(browser);
      if (!browserId) {
        return { ok: false, message: `I don't know a browser called "${browser}".` };
      }
      browserLabel = browser;
    } else if (preferredBrowser) {
      browserId = resolveBrowserId(preferredBrowser);
      browserLabel = browserId ? preferredBrowser : undefined;
    }

    async function invokeOpen(withBrowserId: string | undefined): Promise<void> {
      await capabilityManager.invoke(
        "application_control",
        "open_url",
        { url: normalizedUrl, ...(withBrowserId ? { browserId: withBrowserId } : {}) },
        ctx(actorId),
      );
    }

    try {
      await invokeOpen(browserId);
      contextTracker?.set({ type: "url", url: normalizedUrl, source: "open_url" });
      return {
        ok: true,
        message: browserLabel ? `Opening ${url} in ${browserLabel}.` : `Opening ${url}.`,
      };
    } catch (err) {
      // A *preferred* (not explicitly-named) browser that turns out not
      // to be installed degrades to the system default instead of
      // failing the whole open — real evidence this is still never a
      // silent substitution for an *explicit* request: that path (see
      // `isExplicitBrowser` above) always surfaces
      // `BrowserNotInstalledError`'s own real message unchanged.
      if (!isExplicitBrowser && browserId && err instanceof BrowserNotInstalledError) {
        log.warn("preferred browser unavailable — falling back to system default", {
          preferredBrowser,
          reason: err.message,
        });
        try {
          await invokeOpen(undefined);
          contextTracker?.set({ type: "url", url: normalizedUrl, source: "open_url" });
          return { ok: true, message: `Opening ${url}.` };
        } catch (fallbackErr) {
          return {
            ok: false,
            message: fallbackErr instanceof Error ? fallbackErr.message : `Couldn't open ${url}.`,
          };
        }
      }
      return { ok: false, message: err instanceof Error ? err.message : `Couldn't open ${url}.` };
    }
  },

  async openFile(
    capabilityManager: CapabilityManager,
    actorId: string,
    path: string | undefined,
    contextTracker?: ContextReferenceTracker,
  ): Promise<DesktopActionResult> {
    if (!path) return { ok: false, message: "Which file should I open?" };
    const resolvedPath = stripWrappingQuotes(path);
    const result = await invoke(
      capabilityManager,
      "application_control",
      "open_file",
      { path: resolvedPath },
      actorId,
      `Opening "${path}".`,
    );
    if (result.ok) {
      contextTracker?.set({ type: "file", path: resolvedPath, source: "open_file" });
    }
    return result;
  },

  async openFolder(
    capabilityManager: CapabilityManager,
    actorId: string,
    path: string | undefined,
    contextTracker?: ContextReferenceTracker,
  ): Promise<DesktopActionResult> {
    if (!path) return { ok: false, message: "Which folder should I open?" };
    let resolvedPath = stripWrappingQuotes(path);
    const normalized = resolvedPath.trim().toLowerCase().replace(/^(my|the)\s+/, "").replace(/\s+folder$/, "");
    if (["downloads", "desktop", "documents", "pictures", "videos", "music"].includes(normalized)) {
      try {
        const resolved = (await capabilityManager.invoke(
          "filesystem",
          "well_known_folder",
          { folder: normalized },
          ctx(actorId),
        )) as string;
        if (resolved) resolvedPath = resolved;
      } catch {
        // keep original path
      }
    }
    const result = await invoke(
      capabilityManager,
      "application_control",
      "open_folder",
      { path: resolvedPath },
      actorId,
      `Opening "${path}".`,
    );
    if (result.ok) {
      contextTracker?.set({ type: "folder", path: resolvedPath, source: "open_folder" });
    }
    return result;
  },

  /**
   * The brief's single higher-level dispatcher (PART 1D): distinguishes
   * URL / existing file / existing directory deterministically inside
   * `WindowsAdapter.smartOpen()` — this action is a thin pass-through,
   * not a second classification implementation.
   */
  async smartOpen(
    capabilityManager: CapabilityManager,
    actorId: string,
    target: string | undefined,
    browser: string | undefined,
    contextTracker?: ContextReferenceTracker,
    preferredBrowser?: string,
  ): Promise<DesktopActionResult> {
    if (!target) return { ok: false, message: "What should I open?" };
    let browserId: string | undefined;
    if (browser) {
      browserId = resolveBrowserId(browser);
      if (!browserId) {
        return { ok: false, message: `I don't know a browser called "${browser}".` };
      }
    } else if (preferredBrowser) {
      browserId = resolveBrowserId(preferredBrowser);
    }
    try {
      const result = (await capabilityManager.invoke(
        "application_control",
        "smart_open",
        { target: stripWrappingQuotes(target), ...(browserId ? { browserId } : {}) },
        ctx(actorId),
      )) as { kind: "url" | "file" | "folder"; target: string };
      contextTracker?.set(
        result.kind === "url"
          ? { type: "url", url: result.target, source: "smart_open" }
          : { type: result.kind, path: result.target, source: "smart_open" },
      );
      return { ok: true, message: `Opening ${result.target}.` };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : `Couldn't open "${target}".`,
      };
    }
  },

  /**
   * PART 9-11's "open this"/"play this" — reads
   * `ContextReferenceTracker`'s one real, previously-set reference
   * (never raw conversation text) and dispatches to the matching real
   * open capability. Fails safely and honestly when there's nothing to
   * refer to (PART 10) — this is a read of already-validated state, not
   * a guess.
   */
  async openContextualReference(
    capabilityManager: CapabilityManager,
    actorId: string,
    contextTracker: ContextReferenceTracker,
    preferredBrowser?: string,
  ): Promise<DesktopActionResult> {
    const reference = contextTracker.get();
    if (!reference) {
      return { ok: false, message: "I don't have a file, folder, or link to open right now." };
    }
    if (reference.type === "url" && reference.url) {
      return this.openUrl(
        capabilityManager,
        actorId,
        reference.url,
        undefined,
        contextTracker,
        preferredBrowser,
      );
    }
    if ((reference.type === "file" || reference.type === "media") && reference.path) {
      return this.openFile(capabilityManager, actorId, reference.path, contextTracker);
    }
    if (reference.type === "folder" && reference.path) {
      return this.openFolder(capabilityManager, actorId, reference.path, contextTracker);
    }
    // A reference exists but is missing the field its own type needs
    // (shouldn't happen from any real `set()` call above, but fails
    // honestly rather than guessing if it somehow did).
    return { ok: false, message: "I don't have a file, folder, or link to open right now." };
  },

  // ---- OS power management (see docs/adr/0030, docs/adr/0031) ----
  // Real, two-phase voice confirmation (PART 1-3): the first request
  // for a power action never touches the capability layer at all — it
  // registers a pending confirmation (`PowerConfirmationManager`) and
  // asks the user to say yes/no. Only `executeConfirmedPowerAction`
  // (called from `VoicePipeline.runTurn()`'s own early interception of
  // the *next* turn, once it's recognized as a real "yes" to that exact
  // pending request) reaches `power_management` at all — which still
  // goes through the entire existing, unchanged authorization chain
  // (`CapabilityManager` -> `PowerManager` -> `DestructiveActionGate`,
  // deny-by-default absent a real UI-backed confirmer). Voice
  // confirmation and `DestructiveActionGate` are two independent gates;
  // neither bypasses the other.

  async shutdown(
    capabilityManager: CapabilityManager,
    actorId: string,
    powerConfirmation: PowerConfirmationManager,
  ): Promise<DesktopActionResult> {
    void capabilityManager;
    return requestPowerConfirmation(powerConfirmation, actorId, "shutdown");
  },

  async restart(
    capabilityManager: CapabilityManager,
    actorId: string,
    powerConfirmation: PowerConfirmationManager,
  ): Promise<DesktopActionResult> {
    void capabilityManager;
    return requestPowerConfirmation(powerConfirmation, actorId, "restart");
  },

  async sleep(
    capabilityManager: CapabilityManager,
    actorId: string,
    powerConfirmation: PowerConfirmationManager,
  ): Promise<DesktopActionResult> {
    void capabilityManager;
    return requestPowerConfirmation(powerConfirmation, actorId, "sleep");
  },

  /**
   * The *only* real path that actually reaches `power_management` —
   * called exclusively from `VoicePipeline.runTurn()`'s pending-
   * confirmation interception once a "yes" has genuinely been matched
   * against a real, unexpired pending request (see
   * `power-confirmation.ts`). Never called directly from a voice
   * intent or an AI tool.
   */
  async executeConfirmedPowerAction(
    capabilityManager: CapabilityManager,
    actorId: string,
    action: PowerAction,
  ): Promise<DesktopActionResult> {
    return invoke(
      capabilityManager,
      "power_management",
      action,
      {},
      actorId,
      POWER_ACTION_SUCCESS_MESSAGES[action],
    );
  },

  async getPowerStatus(
    capabilityManager: CapabilityManager,
    actorId: string,
  ): Promise<DesktopActionResult> {
    try {
      const status = (await capabilityManager.invoke(
        "power_management",
        "get_power_status",
        {},
        ctx(actorId),
      )) as any;
      if (!status) return { ok: false, message: "Power status is unavailable." };

      const powerLine =
        status.powerLineStatus === "Online"
          ? "Online (Plugged into AC power)"
          : status.powerLineStatus === "Offline"
            ? "Offline (Running on battery)"
            : status.powerLineStatus;

      const chargeText = status.isCharging ? "Charging" : status.batteryChargeStatus;
      const battPercent =
        status.batteryLifePercent >= 0 ? `${status.batteryLifePercent}%` : "Unknown";

      const summary =
        `Windows Power Information:\n` +
        `- Power Line: ${powerLine}\n` +
        `- Battery: ${battPercent} (${chargeText})\n` +
        `- Power Plan: ${status.activePowerScheme ?? "Balanced"}\n` +
        `- Power State: ${status.isPluggedIn ? "AC Connected (Running on main power)" : "DC Battery (Running on battery power)"}`;

      return { ok: true, message: summary };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "I couldn't retrieve power status.",
      };
    }
  },

  async cancelShutdown(
    capabilityManager: CapabilityManager,
    actorId: string,
  ): Promise<DesktopActionResult> {
    return invoke(
      capabilityManager,
      "power_management",
      "cancel_shutdown",
      {},
      actorId,
      "System shutdown has been cancelled.",
    );
  },

  async lockWorkstation(
    capabilityManager: CapabilityManager,
    actorId: string,
  ): Promise<DesktopActionResult> {
    return invoke(
      capabilityManager,
      "power_management",
      "lock",
      {},
      actorId,
      "Workstation locked.",
    );
  },

  async inspectRegistryKey(
    capabilityManager: CapabilityManager,
    actorId: string,
    hive: string,
    path: string,
  ): Promise<DesktopActionResult> {
    try {
      const info = (await capabilityManager.invoke(
        "registry",
        "inspect_registry_key",
        { hive, path },
        ctx(actorId),
      )) as any;
      if (!info) return { ok: false, message: "Failed to inspect registry key." };
      if (!info.exists) {
        return {
          ok: true,
          message: `Registry key ${hive}\\${path} does not exist.`,
        };
      }
      const subkeysArr = Array.isArray(info.subKeys) ? info.subKeys : info.subKeys ? [info.subKeys] : [];
      const valuesArr = Array.isArray(info.values) ? info.values : info.values ? [info.values] : [];
      const subkeys = subkeysArr.length > 0 ? subkeysArr.join(", ") : "(none)";
      const values = valuesArr.length > 0 ? valuesArr.join(", ") : "(none)";
      return {
        ok: true,
        message:
          `Registry Key: ${info.hive}\\${info.path}\n` +
          `- Exists: Yes\n` +
          `- Subkeys: ${subkeys}\n` +
          `- Values: ${values}`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Error inspecting registry key.",
      };
    }
  },

  async getRegistryValue(
    capabilityManager: CapabilityManager,
    actorId: string,
    hive: string,
    path: string,
    name: string,
  ): Promise<DesktopActionResult> {
    try {
      const val = (await capabilityManager.invoke(
        "registry",
        "get_registry_value",
        { hive, path, name },
        ctx(actorId),
      )) as any;
      if (!val) {
        return {
          ok: true,
          message: `Registry value "${name}" not found under ${hive}\\${path}.`,
        };
      }
      return {
        ok: true,
        message:
          `Registry Value: ${val.hive}\\${val.path}\\${val.name}\n` +
          `- Value: ${JSON.stringify(val.value)}\n` +
          `- Type: ${val.valueType}`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Error reading registry value.",
      };
    }
  },

  async listRegistryValues(
    capabilityManager: CapabilityManager,
    actorId: string,
    hive: string,
    path: string,
  ): Promise<DesktopActionResult> {
    try {
      const rawValues = (await capabilityManager.invoke(
        "registry",
        "list_registry_values",
        { hive, path },
        ctx(actorId),
      )) as any;
      const values = Array.isArray(rawValues) ? rawValues : rawValues ? [rawValues] : [];
      if (!values || values.length === 0) {
        return {
          ok: true,
          message: `No registry values found under ${hive}\\${path}.`,
        };
      }
      const list = values
        .map((v) => `  - ${v.name || "(Default)"}: ${JSON.stringify(v.value)} (${v.valueType})`)
        .join("\n");
      return {
        ok: true,
        message: `Registry values under ${hive}\\${path}:\n${list}`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Error listing registry values.",
      };
    }
  },

  async setRegistryValue(
    capabilityManager: CapabilityManager,
    actorId: string,
    hive: string,
    path: string,
    name: string,
    value: string | number,
    valueType?: string,
  ): Promise<DesktopActionResult> {
    return invoke(
      capabilityManager,
      "registry",
      "set_registry_value",
      { hive, path, name, value, valueType: valueType ?? "REG_SZ" },
      actorId,
      `Registry value "${name}" set successfully under ${hive}\\${path}.`,
    );
  },

  async deleteRegistryKey(
    capabilityManager: CapabilityManager,
    actorId: string,
    hive: string,
    path: string,
  ): Promise<DesktopActionResult> {
    return invoke(
      capabilityManager,
      "registry",
      "delete_registry_key",
      { hive, path },
      actorId,
      `Registry key ${hive}\\${path} has been deleted.`,
    );
  },

  // ---- Windows Services & Task Scheduler ----

  async listServices(
    capabilityManager: CapabilityManager,
    actorId: string,
    query?: string,
  ): Promise<DesktopActionResult> {
    try {
      const raw = await capabilityManager.invoke(
        "background_services",
        "list",
        {},
        ctx(actorId),
      );
      const services = Array.isArray(raw) ? raw : raw ? [raw] : [];
      if (services.length === 0) {
        return { ok: true, message: "No Windows services found." };
      }
      let filtered = services;
      if (query && query.trim()) {
        const q = query.trim().toLowerCase();
        filtered = services.filter(
          (s: any) =>
            (typeof s.name === "string" && s.name.toLowerCase().includes(q)) ||
            (typeof s.displayName === "string" && s.displayName.toLowerCase().includes(q)),
        );
      }
      const count = filtered.length;
      const topList = filtered
        .slice(0, 20)
        .map((s: any) => `${s.displayName || s.name} (${s.name}): ${s.status} [${s.startType}]`)
        .join("\n  - ");
      const more = count > 20 ? `\n  ... and ${count - 20} more` : "";
      return {
        ok: true,
        message: `Windows Services (${count} total):\n  - ${topList}${more}`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Failed to list Windows services.",
      };
    }
  },

  async inspectService(
    capabilityManager: CapabilityManager,
    actorId: string,
    name: string,
  ): Promise<DesktopActionResult> {
    try {
      const s = (await capabilityManager.invoke(
        "background_services",
        "get_service",
        { name },
        ctx(actorId),
      )) as any;
      if (!s) {
        return { ok: true, message: `Windows service "${name}" was not found.` };
      }
      return {
        ok: true,
        message:
          `Windows Service: ${s.displayName} (${s.name})\n` +
          `- Status: ${s.status}\n` +
          `- Startup Type: ${s.startType}\n` +
          `- Critical Service: ${s.critical ? "Yes" : "No"}`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : `Failed to inspect service "${name}".`,
      };
    }
  },

  async getServiceStatus(
    capabilityManager: CapabilityManager,
    actorId: string,
    name: string,
  ): Promise<DesktopActionResult> {
    try {
      const status = await capabilityManager.invoke(
        "background_services",
        "get_service_status",
        { name },
        ctx(actorId),
      );
      return {
        ok: true,
        message: `Windows service "${name}" status is: ${status}.`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : `Failed to get status for service "${name}".`,
      };
    }
  },

  async startService(
    capabilityManager: CapabilityManager,
    actorId: string,
    name: string,
  ): Promise<DesktopActionResult> {
    return invoke(
      capabilityManager,
      "background_services",
      "start_service",
      { name },
      actorId,
      `Windows service "${name}" started successfully.`,
    );
  },

  async stopService(
    capabilityManager: CapabilityManager,
    actorId: string,
    name: string,
  ): Promise<DesktopActionResult> {
    return invoke(
      capabilityManager,
      "background_services",
      "stop_service",
      { name },
      actorId,
      `Windows service "${name}" stopped successfully.`,
    );
  },

  async restartService(
    capabilityManager: CapabilityManager,
    actorId: string,
    name: string,
  ): Promise<DesktopActionResult> {
    return invoke(
      capabilityManager,
      "background_services",
      "restart_service",
      { name },
      actorId,
      `Windows service "${name}" restarted successfully.`,
    );
  },

  async listScheduledTasks(
    capabilityManager: CapabilityManager,
    actorId: string,
    query?: string,
    folderPath?: string,
  ): Promise<DesktopActionResult> {
    try {
      const raw = await capabilityManager.invoke(
        "task_scheduler",
        "list",
        { folderPath },
        ctx(actorId),
      );
      const tasks = Array.isArray(raw) ? raw : raw ? [raw] : [];
      if (tasks.length === 0) {
        return { ok: true, message: "No scheduled tasks found." };
      }
      let filtered = tasks;
      if (query && query.trim()) {
        const q = query.trim().toLowerCase();
        filtered = tasks.filter(
          (t: any) => typeof t.taskName === "string" && t.taskName.toLowerCase().includes(q),
        );
      }
      const count = filtered.length;
      const topList = filtered
        .slice(0, 20)
        .map((t: any) => `${t.taskName} (${t.taskPath}): ${t.state}`)
        .join("\n  - ");
      const more = count > 20 ? `\n  ... and ${count - 20} more` : "";
      return {
        ok: true,
        message: `Scheduled Tasks (${count} total):\n  - ${topList}${more}`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Failed to list scheduled tasks.",
      };
    }
  },

  async inspectScheduledTask(
    capabilityManager: CapabilityManager,
    actorId: string,
    name: string,
    folderPath?: string,
  ): Promise<DesktopActionResult> {
    try {
      const t = (await capabilityManager.invoke(
        "task_scheduler",
        "get",
        { name, folderPath },
        ctx(actorId),
      )) as any;
      if (!t) {
        return { ok: true, message: `Scheduled task "${name}" was not found.` };
      }
      return {
        ok: true,
        message:
          `Scheduled Task: ${t.taskPath}${t.taskName}\n` +
          `- State: ${t.state}\n` +
          `- Enabled: ${t.enabled ? "Yes" : "No"}\n` +
          `- Actions: ${t.actions || "(none)"}\n` +
          `- Triggers: ${t.triggers || "(none)"}\n` +
          `- Description: ${t.description || "(none)"}`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : `Failed to inspect scheduled task "${name}".`,
      };
    }
  },

  async runScheduledTask(
    capabilityManager: CapabilityManager,
    actorId: string,
    name: string,
    folderPath?: string,
  ): Promise<DesktopActionResult> {
    return invoke(
      capabilityManager,
      "task_scheduler",
      "run",
      { name, folderPath },
      actorId,
      `Scheduled task "${name}" started successfully.`,
    );
  },

  async enableScheduledTask(
    capabilityManager: CapabilityManager,
    actorId: string,
    name: string,
    folderPath?: string,
  ): Promise<DesktopActionResult> {
    return invoke(
      capabilityManager,
      "task_scheduler",
      "enable",
      { name, folderPath },
      actorId,
      `Scheduled task "${name}" enabled successfully.`,
    );
  },

  async disableScheduledTask(
    capabilityManager: CapabilityManager,
    actorId: string,
    name: string,
    folderPath?: string,
  ): Promise<DesktopActionResult> {
    return invoke(
      capabilityManager,
      "task_scheduler",
      "disable",
      { name, folderPath },
      actorId,
      `Scheduled task "${name}" disabled successfully.`,
    );
  },

  async createScheduledTask(
    capabilityManager: CapabilityManager,
    actorId: string,
    name: string,
    executable: string,
    args?: string,
    description?: string,
    folderPath?: string,
  ): Promise<DesktopActionResult> {
    return invoke(
      capabilityManager,
      "task_scheduler",
      "create",
      { name, executable, arguments: args, description, folderPath },
      actorId,
      `Scheduled task "${name}" created successfully under ${folderPath || "\\"}.`,
    );
  },

  async deleteScheduledTask(
    capabilityManager: CapabilityManager,
    actorId: string,
    name: string,
    folderPath?: string,
  ): Promise<DesktopActionResult> {
    return invoke(
      capabilityManager,
      "task_scheduler",
      "delete",
      { name, folderPath },
      actorId,
      `Scheduled task "${name}" deleted successfully.`,
    );
  },

  async getNetworkConfiguration(
    capabilityManager: CapabilityManager,
    actorId: string,
    interfaceAlias?: string,
  ): Promise<DesktopActionResult> {
    try {
      const cfg = (await capabilityManager.invoke(
        "networking",
        "get_network_configuration",
        interfaceAlias ? { interfaceAlias } : {},
        ctx(actorId),
      )) as any;
      if (!cfg) {
        return { ok: true, message: `Network configuration not found${interfaceAlias ? ` for "${interfaceAlias}"` : ""}.` };
      }
      const ips = Array.isArray(cfg.ipv4Addresses) && cfg.ipv4Addresses.length > 0 ? cfg.ipv4Addresses.join(", ") : "none";
      const dns = Array.isArray(cfg.dnsServers) && cfg.dnsServers.length > 0 ? cfg.dnsServers.join(", ") : "none";
      const gw = cfg.defaultGateway || "none";
      const dhcp = cfg.dhcpEnabled ? "Enabled" : "Disabled";
      const msg = `Network configuration for ${cfg.interfaceAlias}:\n- Status: ${cfg.status}\n- IPv4: ${ips}\n- Gateway: ${gw}\n- DNS: ${dns}\n- DHCP: ${dhcp}\n- Active: ${cfg.isActive ? "Yes" : "No"}`;
      return { ok: true, message: msg };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "I couldn't get the network configuration.",
      };
    }
  },

  async getDnsConfiguration(
    capabilityManager: CapabilityManager,
    actorId: string,
    interfaceAlias?: string,
  ): Promise<DesktopActionResult> {
    try {
      const dns = (await capabilityManager.invoke(
        "networking",
        "get_dns_configuration",
        interfaceAlias ? { interfaceAlias } : {},
        ctx(actorId),
      )) as any;
      if (!dns) {
        return { ok: true, message: `DNS configuration not found${interfaceAlias ? ` for "${interfaceAlias}"` : ""}.` };
      }
      const servers = Array.isArray(dns.dnsServers) && dns.dnsServers.length > 0 ? dns.dnsServers.join(", ") : "none configured";
      const suffix = dns.connectionSpecificSuffix ? `\n- Connection Suffix: ${dns.connectionSpecificSuffix}` : "";
      return {
        ok: true,
        message: `DNS configuration for ${dns.interfaceAlias}:\n- DNS Servers: ${servers}${suffix}`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "I couldn't get the DNS configuration.",
      };
    }
  },

  async getActiveAdapter(
    capabilityManager: CapabilityManager,
    actorId: string,
  ): Promise<DesktopActionResult> {
    try {
      const active = (await capabilityManager.invoke(
        "networking",
        "get_active_adapter",
        {},
        ctx(actorId),
      )) as any;
      if (!active) {
        return { ok: true, message: "No active network adapter found." };
      }
      const ipv4 = Array.isArray(active.ipv4) ? active.ipv4.join(", ") : active.ipv4 || "none";
      const gw = active.gateway || "none";
      const msg = `Active network adapter: ${active.name} (${active.description})\n- Status: ${active.status}\n- Type: ${active.type}\n- IPv4: ${ipv4}\n- Gateway: ${gw}\n- Speed: ${active.speed || "unknown"}`;
      return { ok: true, message: msg };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "I couldn't identify the active network adapter.",
      };
    }
  },

  async enableNetworkAdapter(
    capabilityManager: CapabilityManager,
    actorId: string,
    interfaceAlias: string,
  ): Promise<DesktopActionResult> {
    return invoke(
      capabilityManager,
      "networking",
      "enable_network_adapter",
      { interfaceAlias },
      actorId,
      `Network adapter "${interfaceAlias}" enabled successfully.`,
    );
  },

  async disableNetworkAdapter(
    capabilityManager: CapabilityManager,
    actorId: string,
    interfaceAlias: string,
  ): Promise<DesktopActionResult> {
    return invoke(
      capabilityManager,
      "networking",
      "disable_network_adapter",
      { interfaceAlias },
      actorId,
      `Network adapter "${interfaceAlias}" disabled successfully.`,
    );
  },

  async setDhcp(
    capabilityManager: CapabilityManager,
    actorId: string,
    interfaceAlias: string,
  ): Promise<DesktopActionResult> {
    return invoke(
      capabilityManager,
      "networking",
      "set_dhcp",
      { interfaceAlias },
      actorId,
      `DHCP configured successfully on "${interfaceAlias}".`,
    );
  },

  async setStaticIp(
    capabilityManager: CapabilityManager,
    actorId: string,
    interfaceAlias: string,
    ipAddress: string,
    prefixLength: number,
    defaultGateway?: string,
  ): Promise<DesktopActionResult> {
    return invoke(
      capabilityManager,
      "networking",
      "set_static_ip",
      { interfaceAlias, ipAddress, prefixLength, defaultGateway },
      actorId,
      `Static IP ${ipAddress}/${prefixLength} configured successfully on "${interfaceAlias}".`,
    );
  },

  async setDns(
    capabilityManager: CapabilityManager,
    actorId: string,
    interfaceAlias: string,
    dnsServers: readonly string[],
  ): Promise<DesktopActionResult> {
    return invoke(
      capabilityManager,
      "networking",
      "set_dns",
      { interfaceAlias, dnsServers },
      actorId,
      `DNS servers configured successfully on "${interfaceAlias}": ${dnsServers.join(", ")}.`,
    );
  },
};

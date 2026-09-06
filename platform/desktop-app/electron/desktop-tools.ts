import type { CapabilityManager } from "@ryper/platform-capability";
import type { ToolDefinition, ToolParameterPropertySchema } from "@ryper/ai-engine";
import { desktopActions } from "./desktop-actions.js";
import type { PowerConfirmationManager } from "./power-confirmation.js";
import type { ContextReferenceTracker } from "./context-reference.js";

/**
 * Real `ToolDefinition`s for `@ryper/ai-engine`'s `ToolRegistry` — the
 * seam `AIOrchestrator`'s multi-round tool-calling loop actually
 * executes. Each `execute()` calls the exact same `desktopActions`
 * implementation `voice-commands.ts`'s `VoiceCommandRouter` handlers
 * call — one real implementation per capability, exposed through two
 * integration surfaces, not duplicated. `name` matches the corresponding
 * `DESKTOP_INTENT_PATTERNS`/`DEFAULT_INTENT_PATTERNS` intent string so
 * `HeuristicToolCallingProvider` can emit a matching `tool_call` by name.
 */
export function buildDesktopToolDefinitions(
  capabilityManager: CapabilityManager,
  powerConfirmation: PowerConfirmationManager,
  contextTracker?: ContextReferenceTracker,
  actorId = "ai-orchestrator",
  /**
   * Reads the user's configured default browser (Settings) fresh on
   * every call — not a value captured once at startup, since the
   * setting can change while the app is running. `undefined` means
   * use the system default, same as if this parameter weren't given
   * at all.
   */
  getPreferredBrowser?: () => string | undefined,
): readonly ToolDefinition[] {
  const stringParam = (
    name: string,
    description: string,
  ): Record<string, ToolParameterPropertySchema> => ({
    [name]: { type: "string", description },
  });

  return [
    {
      spec: {
        name: "open_application",
        description:
          "Opens a known desktop application by name, with no target site/file/folder (e.g. " +
          "'open notepad', 'open calculator', or 'open chrome' with no website named). If a website, " +
          "URL, file, or folder is also mentioned (e.g. 'open YouTube in Chrome'), use open_url, " +
          "open_file, open_folder, or smart_open instead — this tool has no way to pass a target " +
          "along with the application, so using it for those requests would silently drop the target.",
        parameters: {
          type: "object",
          properties: stringParam("app", "The application to open"),
          required: ["app"],
        },
      },
      execute: async (args) => {
        const app = typeof args["app"] === "string" ? args["app"] : undefined;
        const result = await desktopActions.openApplication(
          capabilityManager,
          actorId,
          app,
          contextTracker,
          getPreferredBrowser?.(),
        );
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "close_application",
        description: "Closes a running desktop application by name.",
        parameters: {
          type: "object",
          properties: stringParam("app", "The application to close"),
          required: ["app"],
        },
      },
      execute: async (args) => {
        const app = typeof args["app"] === "string" ? args["app"] : undefined;
        const result = await desktopActions.closeApplication(capabilityManager, actorId, app);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "list_installed_applications",
        description:
          "Lists the installed applications and software programs on the computer. Can optionally filter by name or publisher.",
        parameters: {
          type: "object",
          properties: stringParam("query", "Optional application name or keyword to search for"),
        },
      },
      execute: async (args) => {
        const query = typeof args["query"] === "string" ? args["query"] : undefined;
        const result = await desktopActions.listInstalledApplications(
          capabilityManager,
          actorId,
          query,
        );
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "list_running_applications",
        description:
          "Lists the applications currently running on the computer. Can optionally filter by name.",
        parameters: {
          type: "object",
          properties: stringParam("query", "Optional application name or keyword to filter running applications"),
        },
      },
      execute: async (args) => {
        const query = typeof args["query"] === "string" ? args["query"] : undefined;
        const result = await desktopActions.listRunningApplications(
          capabilityManager,
          actorId,
          query,
        );
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "get_system_info",
        description:
          "Returns comprehensive hardware and operating system information about this computer, " +
          "including CPU model and cores, installed GPU, total and used RAM, storage drives and free space, " +
          "battery and power status, Windows OS version, and network connection status.",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const result = await desktopActions.getSystemInfo(capabilityManager, actorId);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "list_displays",
        description:
          "Lists the monitors and displays connected to this computer, including resolution, bounds, " +
          "primary display status, and refresh rate in Hz.",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const result = await desktopActions.listDisplays(capabilityManager, actorId);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "list_audio_devices",
        description: "Lists the audio playback and recording devices available on this computer.",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const result = await desktopActions.listAudioDevices(capabilityManager, actorId);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "list_network_adapters",
        description:
          "Lists the network adapters (Wi-Fi, Ethernet, virtual) available on this computer, with their " +
          "connection status and link speed.",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const result = await desktopActions.listNetworkAdapters(capabilityManager, actorId);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "list_devices",
        description:
          "Lists the hardware devices and peripherals connected to this computer. Can optionally filter by name or kind.",
        parameters: {
          type: "object",
          properties: stringParam("query", "Optional device name or category keyword to filter by"),
        },
      },
      execute: async (args) => {
        const query = typeof args["query"] === "string" ? args["query"] : undefined;
        const result = await desktopActions.listDevices(capabilityManager, actorId, query);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "volume_up",
        description: "Increases the system audio volume by 10 percent.",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const result = await desktopActions.volumeUp(capabilityManager, actorId);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "volume_down",
        description: "Decreases the system audio volume by 10 percent.",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const result = await desktopActions.volumeDown(capabilityManager, actorId);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "set_volume",
        description: "Sets the system audio volume to an exact percentage (0-100).",
        parameters: {
          type: "object",
          properties: {
            percent: {
              type: "number",
              description: "Target volume percentage",
              minimum: 0,
              maximum: 100,
            },
          },
          required: ["percent"],
        },
      },
      execute: async (args) => {
        const percent =
          typeof args["percent"] === "number" ? args["percent"] : Number(args["percent"]);
        const result = await desktopActions.setVolume(capabilityManager, actorId, percent);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "mute",
        description: "Mutes system audio.",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const result = await desktopActions.mute(capabilityManager, actorId);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "unmute",
        description: "Unmutes system audio.",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const result = await desktopActions.unmute(capabilityManager, actorId);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "show_notification",
        description: "Shows a native desktop notification with a title and a message.",
        parameters: {
          type: "object",
          properties: {
            ...stringParam("title", "The notification's title"),
            ...stringParam("message", "The notification's body text"),
          },
          required: ["title", "message"],
        },
      },
      // Requires automation.execute capability
      requiredCapability: "automation.execute",
      execute: async (args) => {
        const title = typeof args["title"] === "string" ? args["title"] : undefined;
        const message = typeof args["message"] === "string" ? args["message"] : undefined;
        const result = await desktopActions.showNotification(
          capabilityManager,
          actorId,
          title,
          message,
        );
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "list_notifications",
        description: "Lists recent desktop notifications shown during the session.",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Maximum number of notifications to return (default: 20)" },
          },
        },
      },
      execute: async (args) => {
        const limit = typeof args["limit"] === "number" ? args["limit"] : undefined;
        const result = await desktopActions.listNotifications(capabilityManager, actorId, limit);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "get_tray_status",
        description: "Gets the current status of the Windows system tray icon, tooltip, and visibility.",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const result = await desktopActions.getTrayStatus(capabilityManager, actorId);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "update_tray_tooltip",
        description: "Updates the tooltip text displayed when hovering over the Windows system tray icon.",
        parameters: {
          type: "object",
          properties: {
            tooltip: { type: "string", description: "The new tooltip text to set on the tray icon" },
          },
          required: ["tooltip"],
        },
      },
      execute: async (args) => {
        const tooltip = typeof args["tooltip"] === "string" ? args["tooltip"] : "";
        const result = await desktopActions.updateTrayTooltip(capabilityManager, actorId, tooltip);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    ...(["media_play", "media_pause", "media_next", "media_previous"] as const).map(
      (intent): ToolDefinition => {
        const action = intent.replace("media_", "") as "play" | "pause" | "next" | "previous";
        return {
          spec: {
            name: intent,
            description: `Media transport control: ${action}.`,
            parameters: { type: "object", properties: {} },
          },
          execute: async () => {
            const result = await desktopActions.mediaControl(capabilityManager, actorId, action);
            if (!result.ok) throw new Error(result.message);
            return result.message;
          },
        };
      },
    ),

    // ---- Process management (real OS process enumeration via `@ryper/windows-agent`) ----
    {
      spec: {
        name: "list_processes",
        description:
          "Lists the currently running processes on the system, with their PIDs and names. Can optionally filter by name or PID.",
        parameters: {
          type: "object",
          properties: stringParam("query", "Optional name or PID substring to filter processes"),
        },
      },
      execute: async (args) => {
        const query = typeof args["query"] === "string" ? args["query"] : undefined;
        const result = await desktopActions.listProcesses(capabilityManager, actorId, query);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },

    // ---- Window management (real Win32 APIs via `@ryper/windows-agent`'s
    // `WindowManager` — protected by automation.read / automation.execute) ----
    {
      spec: {
        name: "list_windows",
        description:
          "Lists every currently open window and its state (normal/minimized/maximized).",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const result = await desktopActions.listWindows(capabilityManager, actorId);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "get_window_info",
        description:
          "Returns detailed information about the currently open windows, or about a specific window matching a query title.",
        parameters: {
          type: "object",
          properties: stringParam("query", "Optional window title or application name to get details for"),
        },
      },
      execute: async (args) => {
        const query = typeof args["query"] === "string" ? args["query"] : undefined;
        const result = await desktopActions.getWindowInfo(capabilityManager, actorId, query);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "get_active_window",
        description: "Reports which window is currently focused/active.",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const result = await desktopActions.getActiveWindow(capabilityManager, actorId);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "focus_window",
        description:
          "Switches focus to a window by matching its title or application (e.g. 'Chrome', 'Notepad').",
        parameters: {
          type: "object",
          properties: stringParam("window", "The window's title or application to switch to"),
          required: ["window"],
        },
      },
      execute: async (args) => {
        const window = typeof args["window"] === "string" ? args["window"] : undefined;
        const result = await desktopActions.focusWindow(capabilityManager, actorId, window);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "minimize_window",
        description:
          "Minimizes a window by title/application, or the currently active window if none is given.",
        parameters: {
          type: "object",
          properties: stringParam("window", "The window's title or application (optional)"),
        },
      },
      execute: async (args) => {
        const window = typeof args["window"] === "string" ? args["window"] : undefined;
        const result = await desktopActions.minimizeWindow(capabilityManager, actorId, window);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "maximize_window",
        description:
          "Maximizes a window by title/application, or the currently active window if none is given.",
        parameters: {
          type: "object",
          properties: stringParam("window", "The window's title or application (optional)"),
        },
      },
      execute: async (args) => {
        const window = typeof args["window"] === "string" ? args["window"] : undefined;
        const result = await desktopActions.maximizeWindow(capabilityManager, actorId, window);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "restore_window",
        description:
          "Restores a minimized/maximized window to its normal size, by title/application or the currently active window.",
        parameters: {
          type: "object",
          properties: stringParam("window", "The window's title or application (optional)"),
        },
      },
      execute: async (args) => {
        const window = typeof args["window"] === "string" ? args["window"] : undefined;
        const result = await desktopActions.restoreWindow(capabilityManager, actorId, window);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "snap_window",
        description:
          "Snaps a window to one side or corner of the screen (left/right/top/bottom/top-left/top-right/bottom-left/bottom-right).",
        parameters: {
          type: "object",
          properties: {
            position: {
              type: "string",
              description: "Which side or corner to snap to",
              enum: [
                "left",
                "right",
                "top",
                "bottom",
                "top-left",
                "top-right",
                "bottom-left",
                "bottom-right",
              ],
            },
            ...stringParam("window", "The window's title or application (optional)"),
          },
          required: ["position"],
        },
      },
      execute: async (args) => {
        const position = typeof args["position"] === "string" ? args["position"] : undefined;
        const window = typeof args["window"] === "string" ? args["window"] : undefined;
        const result = await desktopActions.snapWindow(
          capabilityManager,
          actorId,
          position,
          window,
        );
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "switch_window",
        description: "Switches focus to the next open window (Alt+Tab-style).",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const result = await desktopActions.switchWindow(capabilityManager, actorId);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },

    // ---- Filesystem (real APIs via `@ryper/windows-agent`'s `FileManager`,
    // previously with zero AI tool surface — closed during the Tier 1
    // completion pass, continued; see docs/adr/0029. In `WINDOWS_CAPABILITY_DESCRIPTORS`,
    // read-only operations (`list_files`, `read_file`, `search_files`, `get_folder_path`,
    // `list_recent_files`) require `"filesystem.read"`, while mutating operations
    // (`create_folder`, `copy_file`, `move_file`, `rename_file`, `delete_file`) require
    // `"filesystem.write"` via `operationCapabilities` — mediated by `CapabilityManager.invoke()`'s
    // own self-granting consent-flow gate (docs/adr/0024), the same one `audio`'s tools rely on.
    // Deliberately not *also* setting `requiredCapability` here: doing so
    // would additionally require a caller to already hold a pre-existing
    // broker grant before `execute()` even runs (the stricter
    // `show_notification`-style gate, docs/adr/0021) — a second, redundant
    // authorization model stacked on top of the domain-level one, for no
    // real benefit over the single self-granting gate every other desktop
    // tool here already goes through.) ----
    {
      spec: {
        name: "list_files",
        description:
          "Lists the files and folders (including their sizes in bytes) in a given directory path (e.g. 'downloads' or an absolute path). Optionally filter by file pattern (e.g. '*.pdf').",
        parameters: {
          type: "object",
          properties: {
            ...stringParam("path", "The folder path to list (e.g. 'downloads' or an absolute path)"),
            ...stringParam("pattern", "Optional wildcard pattern or file extension to filter by (e.g. '*.pdf')"),
          },
          required: ["path"],
        },
      },
      execute: async (args) => {
        const path = typeof args["path"] === "string" ? args["path"] : undefined;
        const pattern = typeof args["pattern"] === "string" ? args["pattern"] : undefined;
        const result = await desktopActions.listFiles(capabilityManager, actorId, path, pattern);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "read_file",
        description: "Reads and returns the text contents of a file.",
        parameters: {
          type: "object",
          properties: stringParam("path", "The file path to read"),
          required: ["path"],
        },
      },
      execute: async (args) => {
        const path = typeof args["path"] === "string" ? args["path"] : undefined;
        const result = await desktopActions.readFile(capabilityManager, actorId, path);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "search_files",
        description:
          "Searches for files by name or pattern (e.g. '*.pdf'), optionally scoped to a root folder (e.g. 'downloads'). Returns matching file paths and sizes in bytes.",
        parameters: {
          type: "object",
          properties: {
            ...stringParam("query", "The filename or pattern to search for (e.g. '*.pdf' or 'report')"),
            ...stringParam("rootPath", "Optional folder to scope the search to (e.g. 'downloads' or an absolute path)"),
          },
          required: ["query"],
        },
      },
      execute: async (args) => {
        const query = typeof args["query"] === "string" ? args["query"] : undefined;
        const rootPath = typeof args["rootPath"] === "string" ? args["rootPath"] : undefined;
        const result = await desktopActions.searchFiles(
          capabilityManager,
          actorId,
          query,
          rootPath,
        );
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "get_folder_path",
        description:
          "Resolves a well-known folder (downloads/desktop/documents/pictures/videos/music) to its real path.",
        parameters: {
          type: "object",
          properties: {
            folder: {
              type: "string",
              description: "Which well-known folder",
              enum: ["downloads", "desktop", "documents", "pictures", "videos", "music"],
            },
          },
          required: ["folder"],
        },
      },
      execute: async (args) => {
        const folder = typeof args["folder"] === "string" ? args["folder"] : undefined;
        const result = await desktopActions.getFolderPath(capabilityManager, actorId, folder);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "list_recent_files",
        description: "Lists recently accessed files.",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const result = await desktopActions.listRecentFiles(capabilityManager, actorId);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "create_folder",
        description: "Creates a new folder at the given path.",
        parameters: {
          type: "object",
          properties: stringParam("path", "The new folder's path"),
          required: ["path"],
        },
      },
      execute: async (args) => {
        const path = typeof args["path"] === "string" ? args["path"] : undefined;
        const result = await desktopActions.createFolder(capabilityManager, actorId, path);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "copy_file",
        description: "Copies a file or folder from one path to another.",
        parameters: {
          type: "object",
          properties: {
            ...stringParam("sourcePath", "The file/folder to copy"),
            ...stringParam("destinationPath", "Where to copy it to"),
          },
          required: ["sourcePath", "destinationPath"],
        },
      },
      execute: async (args) => {
        const sourcePath = typeof args["sourcePath"] === "string" ? args["sourcePath"] : undefined;
        const destinationPath =
          typeof args["destinationPath"] === "string" ? args["destinationPath"] : undefined;
        const result = await desktopActions.copyFile(
          capabilityManager,
          actorId,
          sourcePath,
          destinationPath,
        );
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "move_file",
        description: "Moves a file or folder from one path to another.",
        parameters: {
          type: "object",
          properties: {
            ...stringParam("sourcePath", "The file/folder to move"),
            ...stringParam("destinationPath", "Where to move it to"),
          },
          required: ["sourcePath", "destinationPath"],
        },
      },
      execute: async (args) => {
        const sourcePath = typeof args["sourcePath"] === "string" ? args["sourcePath"] : undefined;
        const destinationPath =
          typeof args["destinationPath"] === "string" ? args["destinationPath"] : undefined;
        const result = await desktopActions.moveFile(
          capabilityManager,
          actorId,
          sourcePath,
          destinationPath,
        );
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "rename_file",
        description: "Renames a file or folder.",
        parameters: {
          type: "object",
          properties: {
            ...stringParam("path", "The file/folder to rename"),
            ...stringParam("newName", "Its new name"),
          },
          required: ["path", "newName"],
        },
      },
      execute: async (args) => {
        const path = typeof args["path"] === "string" ? args["path"] : undefined;
        const newName = typeof args["newName"] === "string" ? args["newName"] : undefined;
        const result = await desktopActions.renameFile(capabilityManager, actorId, path, newName);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "delete_file",
        description:
          "Deletes a file or folder. Destructive — requires explicit confirmation via the real DestructiveActionGate, which denies by default.",
        parameters: {
          type: "object",
          properties: stringParam("path", "The file/folder to delete"),
          required: ["path"],
        },
      },
      execute: async (args) => {
        const path = typeof args["path"] === "string" ? args["path"] : undefined;
        const result = await desktopActions.deleteFile(
          capabilityManager,
          actorId,
          path,
          contextTracker,
        );
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },

    // ---- Universal open capability (see docs/adr/0030). Descriptions
    // are written to specifically head off the failure mode PART 11
    // calls out: "open YouTube in Chrome" must select `open_url` with
    // both `url` and `browser` filled in, not collapse into
    // `open_application("chrome")` and silently drop the URL. ----
    {
      spec: {
        name: "open_url",
        description:
          "Opens a website URL in a browser. Use this whenever the request names a website or URL " +
          "(e.g. 'open YouTube', 'go to github.com', 'open https://...') — even if a specific browser " +
          "is also named (e.g. 'open YouTube in Chrome': url='https://youtube.com', browser='chrome'). " +
          "Do NOT use open_application for this — open_application has no way to also pass a URL, so " +
          "using it here would silently launch the browser without the site the user actually asked for. " +
          "If no browser is named, the system default browser is used.",
        parameters: {
          type: "object",
          properties: {
            ...stringParam(
              "url",
              "The website URL or domain to open (e.g. 'youtube.com' or 'https://youtube.com')",
            ),
            browser: {
              type: "string",
              description: "Optional: a specific browser to open it in",
              enum: ["chrome", "edge", "firefox", "brave"],
            },
          },
          required: ["url"],
        },
      },
      execute: async (args) => {
        const url = typeof args["url"] === "string" ? args["url"] : undefined;
        const browser = typeof args["browser"] === "string" ? args["browser"] : undefined;
        const result = await desktopActions.openUrl(
          capabilityManager,
          actorId,
          url,
          browser,
          contextTracker,
          getPreferredBrowser?.(),
        );
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "open_file",
        description:
          "Opens a file with its registered/default Windows application (e.g. a PDF in the PDF " +
          "reader, an image in the photo viewer). Use this for 'open this image/video/PDF/document' " +
          "style requests. Not for reading a file's text contents — use read_file for that.",
        parameters: {
          type: "object",
          properties: stringParam("path", "The full path of the file to open"),
          required: ["path"],
        },
      },
      execute: async (args) => {
        const path = typeof args["path"] === "string" ? args["path"] : undefined;
        const result = await desktopActions.openFile(
          capabilityManager,
          actorId,
          path,
          contextTracker,
        );
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "open_folder",
        description:
          "Opens a folder in Windows Explorer (e.g. 'open my Downloads folder', 'show me this folder').",
        parameters: {
          type: "object",
          properties: stringParam(
            "path",
            "The folder path, or a well-known folder name like 'Downloads'",
          ),
          required: ["path"],
        },
      },
      execute: async (args) => {
        const path = typeof args["path"] === "string" ? args["path"] : undefined;
        const result = await desktopActions.openFolder(
          capabilityManager,
          actorId,
          path,
          contextTracker,
        );
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "smart_open",
        description:
          "Opens something when it's ambiguous whether it's a website, a file, or a folder — " +
          "automatically detects which and opens it the right way. Prefer open_url/open_file/" +
          "open_folder directly when you already know which one it is; use smart_open only for a " +
          "genuinely ambiguous target string.",
        parameters: {
          type: "object",
          properties: {
            ...stringParam("target", "The URL, file path, or folder path to open"),
            browser: {
              type: "string",
              description:
                "Optional: if the target turns out to be a URL, open it in this specific browser",
              enum: ["chrome", "edge", "firefox", "brave"],
            },
          },
          required: ["target"],
        },
      },
      execute: async (args) => {
        const target = typeof args["target"] === "string" ? args["target"] : undefined;
        const browser = typeof args["browser"] === "string" ? args["browser"] : undefined;
        const result = await desktopActions.smartOpen(
          capabilityManager,
          actorId,
          target,
          browser,
          contextTracker,
          getPreferredBrowser?.(),
        );
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "open_this",
        description:
          "Opens whatever the user most recently referred to (e.g. 'open this', 'open this folder', " +
          "'play this video', 'open that PDF') — uses the real file/folder/URL the user last " +
          "successfully opened. Fails clearly if there's nothing to refer to yet; never guesses.",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        if (!contextTracker) {
          throw new Error("I don't have a file, folder, or link to open right now.");
        }
        const result = await desktopActions.openContextualReference(
          capabilityManager,
          actorId,
          contextTracker,
          getPreferredBrowser?.(),
        );
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "list_browsers",
        description:
          "Lists which of the supported browsers (Chrome, Edge, Firefox, Brave) are actually " +
          "installed on this PC. Useful before recommending or trying a specific browser.",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const result = await desktopActions.listAvailableBrowsers(capabilityManager, actorId);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "launch_browser",
        description:
          "Opens a specific browser with no target website (e.g. 'open Chrome' with nothing else " +
          "named). Use open_url instead if a website/URL is also mentioned.",
        parameters: {
          type: "object",
          properties: {
            browser: {
              type: "string",
              description: "Which browser to open",
              enum: ["chrome", "edge", "firefox", "brave"],
            },
          },
          required: ["browser"],
        },
      },
      execute: async (args) => {
        const browser = typeof args["browser"] === "string" ? args["browser"] : undefined;
        const result = await desktopActions.launchNamedBrowser(capabilityManager, actorId, browser);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },

    // ---- OS power management (see docs/adr/0030, docs/adr/0031). Every
    // one of these is a real, two-phase voice confirmation request
    // (PART 1) — this call only ever registers the pending confirmation
    // and returns the spoken prompt; it never itself reaches the real
    // Windows power action. Only a genuine "yes" on a *later* turn
    // (matched in VoicePipeline.runTurn(), see power-confirmation.ts)
    // actually executes it, still through the full existing
    // DestructiveActionGate chain underneath. ----
    {
      spec: {
        name: "shutdown",
        description:
          "Shuts down the PC. Destructive — this only asks the user to confirm; it never shuts down " +
          "immediately. The actual shutdown only happens if the user says yes on their next turn.",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const result = await desktopActions.shutdown(capabilityManager, actorId, powerConfirmation);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "restart",
        description:
          "Restarts the PC. Destructive — this only asks the user to confirm; it never restarts " +
          "immediately. The actual restart only happens if the user says yes on their next turn.",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const result = await desktopActions.restart(capabilityManager, actorId, powerConfirmation);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "sleep",
        description:
          "Puts the PC to sleep. System-impacting — this only asks the user to confirm; it never puts " +
          "the PC to sleep immediately. It only happens if the user says yes on their next turn.",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const result = await desktopActions.sleep(capabilityManager, actorId, powerConfirmation);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "get_power_status",
        description:
          "Returns real-time Windows power and battery status, including whether the computer is " +
          "plugged into AC power or running on battery, battery charge percentage, charging state, " +
          "and active power plan scheme.",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const result = await desktopActions.getPowerStatus(capabilityManager, actorId);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "lock_workstation",
        description:
          "Locks the Windows workstation screen. Requires user credentials to unlock.",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const result = await desktopActions.lockWorkstation(capabilityManager, actorId);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "cancel_shutdown",
        description:
          "Cancels any scheduled or pending system shutdown on this computer.",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const result = await desktopActions.cancelShutdown(capabilityManager, actorId);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "inspect_registry_key",
        description:
          "Inspects a Windows registry key to check if it exists, list its child subkeys, and list its value names. " +
          "Hive must be HKCU (current user) or HKLM (local machine). Path is relative to the hive (e.g. 'Software\\RYPER\\Certification').",
        parameters: {
          type: "object",
          properties: {
            hive: { type: "string", description: "Registry hive (e.g. 'HKCU' or 'HKLM')" },
            path: { type: "string", description: "Path under the hive (e.g. 'Software\\RYPER\\Certification')" },
          },
          required: ["hive", "path"],
        },
      },
      execute: async (args) => {
        const hive = typeof args["hive"] === "string" ? args["hive"] : "HKCU";
        const path = typeof args["path"] === "string" ? args["path"] : "";
        const result = await desktopActions.inspectRegistryKey(capabilityManager, actorId, hive, path);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "get_registry_value",
        description:
          "Reads a specific Windows registry value from a given key path and value name. Returns the value content and type (REG_SZ, REG_DWORD, etc.).",
        parameters: {
          type: "object",
          properties: {
            hive: { type: "string", description: "Registry hive (e.g. 'HKCU' or 'HKLM')" },
            path: { type: "string", description: "Path under the hive (e.g. 'Software\\RYPER\\Certification')" },
            name: { type: "string", description: "Value name to read (e.g. 'CertificationStatus' or empty for default value)" },
          },
          required: ["hive", "path", "name"],
        },
      },
      execute: async (args) => {
        const hive = typeof args["hive"] === "string" ? args["hive"] : "HKCU";
        const path = typeof args["path"] === "string" ? args["path"] : "";
        const name = typeof args["name"] === "string" ? args["name"] : "";
        const result = await desktopActions.getRegistryValue(capabilityManager, actorId, hive, path, name);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "list_registry_values",
        description:
          "Lists all Windows registry values (names, values, and data types) located directly under a specified key path.",
        parameters: {
          type: "object",
          properties: {
            hive: { type: "string", description: "Registry hive (e.g. 'HKCU' or 'HKLM')" },
            path: { type: "string", description: "Path under the hive (e.g. 'Software\\RYPER\\Certification')" },
          },
          required: ["hive", "path"],
        },
      },
      execute: async (args) => {
        const hive = typeof args["hive"] === "string" ? args["hive"] : "HKCU";
        const path = typeof args["path"] === "string" ? args["path"] : "";
        const result = await desktopActions.listRegistryValues(capabilityManager, actorId, hive, path);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "set_registry_value",
        description:
          "Sets or creates a Windows registry value under a key path. Supports REG_SZ (string) and REG_DWORD (integer). Hive can be HKCU or HKLM.",
        parameters: {
          type: "object",
          properties: {
            hive: { type: "string", description: "Registry hive (e.g. 'HKCU' or 'HKLM')" },
            path: { type: "string", description: "Path under the hive (e.g. 'Software\\RYPER\\Certification')" },
            name: { type: "string", description: "Value name to set" },
            value: { type: "string", description: "Value data to set" },
            valueType: { type: "string", description: "Registry type: 'REG_SZ' (default) or 'REG_DWORD'" },
          },
          required: ["hive", "path", "name", "value"],
        },
      },
      execute: async (args) => {
        const hive = typeof args["hive"] === "string" ? args["hive"] : "HKCU";
        const path = typeof args["path"] === "string" ? args["path"] : "";
        const name = typeof args["name"] === "string" ? args["name"] : "";
        const value = typeof args["value"] === "string" || typeof args["value"] === "number" ? args["value"] : String(args["value"] ?? "");
        const valueType = typeof args["valueType"] === "string" ? args["valueType"] : undefined;
        const result = await desktopActions.setRegistryValue(capabilityManager, actorId, hive, path, name, value, valueType);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "delete_registry_key",
        description:
          "Deletes a Windows registry key and all of its values. Destructive action requiring user confirmation.",
        parameters: {
          type: "object",
          properties: {
            hive: { type: "string", description: "Registry hive (e.g. 'HKCU' or 'HKLM')" },
            path: { type: "string", description: "Path under the hive to delete (e.g. 'Software\\RYPER\\Certification')" },
          },
          required: ["hive", "path"],
        },
      },
      execute: async (args) => {
        const hive = typeof args["hive"] === "string" ? args["hive"] : "HKCU";
        const path = typeof args["path"] === "string" ? args["path"] : "";
        const result = await desktopActions.deleteRegistryKey(capabilityManager, actorId, hive, path);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "list_services",
        description:
          "Lists Windows services installed on the system, including service name, display name, running status, and startup type. Can optionally filter by name or keyword.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Optional service name, display name, or keyword filter" },
          },
        },
      },
      execute: async (args) => {
        const query = typeof args["query"] === "string" ? args["query"] : undefined;
        const result = await desktopActions.listServices(capabilityManager, actorId, query);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "inspect_service",
        description:
          "Inspects a specific Windows service by its service name or display name (e.g. 'Audiosrv' or 'Windows Audio'). Returns status, startup type, and whether it is critical to system stability.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "The service name or display name to inspect" },
          },
          required: ["name"],
        },
      },
      execute: async (args) => {
        const name = typeof args["name"] === "string" ? args["name"] : "";
        const result = await desktopActions.inspectService(capabilityManager, actorId, name);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "get_service_status",
        description: "Gets the current running status (running, stopped, paused) of a Windows service.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "The service name or display name" },
          },
          required: ["name"],
        },
      },
      execute: async (args) => {
        const name = typeof args["name"] === "string" ? args["name"] : "";
        const result = await desktopActions.getServiceStatus(capabilityManager, actorId, name);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "start_service",
        description: "Starts a stopped Windows service by name. Requires automation.execute capability.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "The service name to start" },
          },
          required: ["name"],
        },
      },
      execute: async (args) => {
        const name = typeof args["name"] === "string" ? args["name"] : "";
        const result = await desktopActions.startService(capabilityManager, actorId, name);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "stop_service",
        description: "Stops a running Windows service by name. If the service is critical, requires user confirmation.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "The service name to stop" },
          },
          required: ["name"],
        },
      },
      execute: async (args) => {
        const name = typeof args["name"] === "string" ? args["name"] : "";
        const result = await desktopActions.stopService(capabilityManager, actorId, name);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "restart_service",
        description: "Restarts a Windows service by name.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "The service name to restart" },
          },
          required: ["name"],
        },
      },
      execute: async (args) => {
        const name = typeof args["name"] === "string" ? args["name"] : "";
        const result = await desktopActions.restartService(capabilityManager, actorId, name);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "list_scheduled_tasks",
        description:
          "Lists scheduled tasks configured in Windows Task Scheduler. Returns task name, path, and state (ready, running, disabled). Can filter by keyword or folder path.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Optional task name or keyword filter" },
            folderPath: { type: "string", description: "Optional task folder path (e.g. '\\' or '\\Microsoft\\Windows')" },
          },
        },
      },
      execute: async (args) => {
        const query = typeof args["query"] === "string" ? args["query"] : undefined;
        const folderPath = typeof args["folderPath"] === "string" ? args["folderPath"] : undefined;
        const result = await desktopActions.listScheduledTasks(capabilityManager, actorId, query, folderPath);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "inspect_scheduled_task",
        description:
          "Inspects detailed configuration of a Windows scheduled task, including its executable actions, triggers, enabled state, and description.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Task name to inspect" },
            folderPath: { type: "string", description: "Optional folder path where the task is located" },
          },
          required: ["name"],
        },
      },
      execute: async (args) => {
        const name = typeof args["name"] === "string" ? args["name"] : "";
        const folderPath = typeof args["folderPath"] === "string" ? args["folderPath"] : undefined;
        const result = await desktopActions.inspectScheduledTask(capabilityManager, actorId, name, folderPath);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "run_scheduled_task",
        description: "Runs / starts a scheduled task on demand in Windows Task Scheduler.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Task name to run" },
            folderPath: { type: "string", description: "Optional folder path" },
          },
          required: ["name"],
        },
      },
      execute: async (args) => {
        const name = typeof args["name"] === "string" ? args["name"] : "";
        const folderPath = typeof args["folderPath"] === "string" ? args["folderPath"] : undefined;
        const result = await desktopActions.runScheduledTask(capabilityManager, actorId, name, folderPath);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "enable_scheduled_task",
        description: "Enables a currently disabled Windows scheduled task.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Task name to enable" },
            folderPath: { type: "string", description: "Optional folder path" },
          },
          required: ["name"],
        },
      },
      execute: async (args) => {
        const name = typeof args["name"] === "string" ? args["name"] : "";
        const folderPath = typeof args["folderPath"] === "string" ? args["folderPath"] : undefined;
        const result = await desktopActions.enableScheduledTask(capabilityManager, actorId, name, folderPath);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "disable_scheduled_task",
        description: "Disables a Windows scheduled task so it will not run automatically.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Task name to disable" },
            folderPath: { type: "string", description: "Optional folder path" },
          },
          required: ["name"],
        },
      },
      execute: async (args) => {
        const name = typeof args["name"] === "string" ? args["name"] : "";
        const folderPath = typeof args["folderPath"] === "string" ? args["folderPath"] : undefined;
        const result = await desktopActions.disableScheduledTask(capabilityManager, actorId, name, folderPath);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "create_scheduled_task",
        description:
          "Creates a new scheduled task in Windows Task Scheduler. Creates persistent automated execution, requiring user confirmation.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name of the task to create" },
            executable: { type: "string", description: "Executable file or command path to run" },
            arguments: { type: "string", description: "Optional command-line arguments" },
            description: { type: "string", description: "Optional description of what the task does" },
            folderPath: { type: "string", description: "Optional task folder path (defaults to '\\')" },
          },
          required: ["name", "executable"],
        },
      },
      execute: async (args) => {
        const name = typeof args["name"] === "string" ? args["name"] : "";
        const executable = typeof args["executable"] === "string" ? args["executable"] : "";
        const argumentsParam = typeof args["arguments"] === "string" ? args["arguments"] : undefined;
        const description = typeof args["description"] === "string" ? args["description"] : undefined;
        const folderPath = typeof args["folderPath"] === "string" ? args["folderPath"] : undefined;
        const result = await desktopActions.createScheduledTask(
          capabilityManager,
          actorId,
          name,
          executable,
          argumentsParam,
          description,
          folderPath,
        );
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "delete_scheduled_task",
        description:
          "Permanently deletes / unregisters a scheduled task from Windows Task Scheduler. Destructive action requiring user confirmation.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Task name to delete" },
            folderPath: { type: "string", description: "Optional folder path" },
          },
          required: ["name"],
        },
      },
      execute: async (args) => {
        const name = typeof args["name"] === "string" ? args["name"] : "";
        const folderPath = typeof args["folderPath"] === "string" ? args["folderPath"] : undefined;
        const result = await desktopActions.deleteScheduledTask(capabilityManager, actorId, name, folderPath);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "get_network_configuration",
        description: "Gets detailed network configuration (IP addresses, default gateway, DNS servers, DHCP status) for a specific network adapter or the active adapter.",
        parameters: {
          type: "object",
          properties: {
            interfaceAlias: { type: "string", description: "Optional name/alias of the adapter (e.g. 'Wi-Fi', 'Ethernet')" },
          },
        },
      },
      execute: async (args) => {
        const interfaceAlias = typeof args["interfaceAlias"] === "string" ? args["interfaceAlias"] : undefined;
        const result = await desktopActions.getNetworkConfiguration(capabilityManager, actorId, interfaceAlias);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "get_dns_configuration",
        description: "Gets DNS server configuration and connection suffixes for a specific network adapter or the active adapter.",
        parameters: {
          type: "object",
          properties: {
            interfaceAlias: { type: "string", description: "Optional name/alias of the adapter (e.g. 'Wi-Fi')" },
          },
        },
      },
      execute: async (args) => {
        const interfaceAlias = typeof args["interfaceAlias"] === "string" ? args["interfaceAlias"] : undefined;
        const result = await desktopActions.getDnsConfiguration(capabilityManager, actorId, interfaceAlias);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "get_active_adapter",
        description: "Gets the primary active network adapter currently carrying Internet and default route traffic.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
      execute: async () => {
        const result = await desktopActions.getActiveAdapter(capabilityManager, actorId);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "enable_network_adapter",
        description: "Enables a disabled network adapter on the system. Requires administrative privileges.",
        parameters: {
          type: "object",
          properties: {
            interfaceAlias: { type: "string", description: "Name/alias of the network adapter to enable (e.g. 'Ethernet')" },
          },
          required: ["interfaceAlias"],
        },
      },
      execute: async (args) => {
        const interfaceAlias = typeof args["interfaceAlias"] === "string" ? args["interfaceAlias"] : "";
        const result = await desktopActions.enableNetworkAdapter(capabilityManager, actorId, interfaceAlias);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "disable_network_adapter",
        description: "Disables a network adapter on the system. If targeted at the active network adapter, this is a destructive action requiring user confirmation and administrative privileges.",
        parameters: {
          type: "object",
          properties: {
            interfaceAlias: { type: "string", description: "Name/alias of the network adapter to disable (e.g. 'Ethernet')" },
          },
          required: ["interfaceAlias"],
        },
      },
      execute: async (args) => {
        const interfaceAlias = typeof args["interfaceAlias"] === "string" ? args["interfaceAlias"] : "";
        const result = await desktopActions.disableNetworkAdapter(capabilityManager, actorId, interfaceAlias);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "set_dhcp",
        description: "Configures a network adapter to automatically obtain its IP address and DNS settings via DHCP.",
        parameters: {
          type: "object",
          properties: {
            interfaceAlias: { type: "string", description: "Name/alias of the network adapter (e.g. 'Ethernet')" },
          },
          required: ["interfaceAlias"],
        },
      },
      execute: async (args) => {
        const interfaceAlias = typeof args["interfaceAlias"] === "string" ? args["interfaceAlias"] : "";
        const result = await desktopActions.setDhcp(capabilityManager, actorId, interfaceAlias);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "set_static_ip",
        description: "Assigns a static IP address, prefix length (subnet mask), and optional default gateway to a network adapter.",
        parameters: {
          type: "object",
          properties: {
            interfaceAlias: { type: "string", description: "Name/alias of the network adapter" },
            ipAddress: { type: "string", description: "Static IPv4 or IPv6 address (e.g. '192.168.1.150')" },
            prefixLength: { type: "number", description: "Subnet prefix length (e.g. 24 for 255.255.255.0)" },
            defaultGateway: { type: "string", description: "Optional default gateway IP address" },
          },
          required: ["interfaceAlias", "ipAddress", "prefixLength"],
        },
      },
      execute: async (args) => {
        const interfaceAlias = typeof args["interfaceAlias"] === "string" ? args["interfaceAlias"] : "";
        const ipAddress = typeof args["ipAddress"] === "string" ? args["ipAddress"] : "";
        const prefixLength = typeof args["prefixLength"] === "number" ? args["prefixLength"] : 24;
        const defaultGateway = typeof args["defaultGateway"] === "string" ? args["defaultGateway"] : undefined;
        const result = await desktopActions.setStaticIp(
          capabilityManager,
          actorId,
          interfaceAlias,
          ipAddress,
          prefixLength,
          defaultGateway,
        );
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
    {
      spec: {
        name: "set_dns",
        description: "Configures static DNS server addresses for a network adapter.",
        parameters: {
          type: "object",
          properties: {
            interfaceAlias: { type: "string", description: "Name/alias of the network adapter" },
            dnsServers: {
              type: "array",
              description: "List of DNS server IP addresses (e.g. ['8.8.8.8', '1.1.1.1'])",
            },
          },
          required: ["interfaceAlias", "dnsServers"],
        },
      },
      execute: async (args) => {
        const interfaceAlias = typeof args["interfaceAlias"] === "string" ? args["interfaceAlias"] : "";
        const dnsServers = Array.isArray(args["dnsServers"])
          ? (args["dnsServers"] as string[])
          : [];
        const result = await desktopActions.setDns(capabilityManager, actorId, interfaceAlias, dnsServers);
        if (!result.ok) throw new Error(result.message);
        return result.message;
      },
    },
  ];
}

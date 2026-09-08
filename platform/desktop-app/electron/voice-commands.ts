import type { CapabilityManager } from "@ryper/platform-capability";
import type { IntentPattern, VoiceCommandHandler, VoiceCommandResult } from "@ryper/voice-engine";
import { desktopActions } from "./desktop-actions.js";
import type { PowerConfirmationManager } from "./power-confirmation.js";
import type { ContextReferenceTracker } from "./context-reference.js";

/**
 * Voice-command intent patterns beyond `@ryper/voice-engine`'s
 * `DEFAULT_INTENT_PATTERNS` — the mechanical, deterministic desktop
 * commands the brief lists (volume, mute, media transport, closing an
 * application) that don't need an LLM round-trip to execute. Composed
 * with the defaults when constructing the desktop app's `IntentDetector`
 * (see `voice-bootstrap.ts`), not a replacement for them. Also reused by
 * `heuristic-ai-provider.ts` so the AIOrchestrator tool-calling path
 * recognizes the exact same commands, not a second, divergent set.
 */
export const DESKTOP_INTENT_PATTERNS: readonly IntentPattern[] = [
  { intent: "close_application", pattern: /^close (?<app>.+)$/i, slotNames: ["app"] },

  // A real, domain-validated "open_url" pattern (matching "open X.tld"
  // and "go to X.tld") already exists in `DEFAULT_INTENT_PATTERNS` —
  // no duplicate needed here. `desktopActions.openApplication`'s own
  // fallback chain (in `desktop-actions.ts`) separately handles
  // "open ..." phrasing that doesn't look like a real domain (well-known
  // site names, explicit URLs, known folders, file paths) — that
  // pattern being unreachable via a "open"-prefixed voice pattern (see
  // its own comment there) is why that logic lives in the handler
  // itself rather than a second regex.
  // "Show me this folder" (a bare demonstrative with no named target)
  // and "open this"/"open this folder"/"open that PDF" all start with
  // "open "/"show me " and are handled by `desktopActions.openApplication`'s
  // own fallback chain instead (see the real `ContextReferenceTracker`,
  // `context-reference.ts`, docs/adr/0031) — a dedicated pattern
  // starting with "open" could never be reached, same reasoning as the
  // "open_url" case above. "Play this/that ..." doesn't start with
  // "open ", so it gets a real, dedicated pattern below.
  {
    intent: "open_this",
    pattern: /^play (?:this|that)(?:\s+\w+)?$/i,
  },
  {
    intent: "open_this",
    pattern: /^show me (?:this|that)(?:\s+\w+)?$/i,
  },
  {
    intent: "open_this",
    pattern: /^(?:(?:open|do|play|run|show)(?: (?:it|this|that))? )?again$/i,
  },
  {
    intent: "open_this",
    pattern: /^(?:fir se|phir se|dobara)(?: (?:kholo|chalao|karo|dikhao))?$/i,
  },
  {
    intent: "open_this",
    pattern: /^(?:kholo|chalao|dikhao) (?:fir se|phir se|dobara)$/i,
  },
  {
    intent: "open_folder",
    pattern: /^(?:open|show me)(?: (?:the|my))? (?<path>downloads|desktop|documents|pictures|videos|music)(?: folder)?$/i,
    slotNames: ["path"],
  },
  {
    intent: "open_folder",
    pattern: /^show me (?:the |my )?(?!this\b|that\b)(?<path>.+?)\s+folder$/i,
    slotNames: ["path"],
  },
  {
    intent: "volume_up",
    pattern:
      /^(?:volume up|turn (?:the )?volume up|increase (?:the )?volume|volume badhao|aawaz badhao|आवाज़ बढ़ाओ|वॉल्यूम बढ़ाओ)$/i,
  },
  {
    intent: "volume_down",
    pattern:
      /^(?:volume down|turn (?:the )?volume down|decrease (?:the )?volume|lower (?:the )?volume(?: to (?<percent>\d+)(?:\s*%|\s*percent)?)?|volume kam karo|aawaz kam karo|आवाज़ कम करो|वॉल्यूम कम करो)$/i,
    slotNames: ["percent"],
  },
  {
    intent: "set_volume",
    pattern:
      /^(?:set (?:the )?volume to (?<percent>\d+)(?:\s*%|\s*percent)?|(?:volume|aawaz) (?<percent2>\d+)(?:\s*%|\s*percent)? (?:karo|set karo))$/i,
    slotNames: ["percent", "percent2"],
  },
  {
    intent: "mute",
    pattern:
      /^(?:mute(?: (?:the )?(?:audio|volume|sound))?|mute karo|aawaz band karo|आवाज़ बंद करो|म्यूट करो)$/i,
  },
  {
    intent: "unmute",
    pattern:
      /^(?:unmute(?: (?:the )?(?:audio|volume|sound))?|unmute karo|aawaz chalu karo|आवाज़ चालू करो|अनम्यूट करो)$/i,
  },
  {
    intent: "media_play",
    pattern:
      /^(?:(?:play|resume)(?: (?:the )?music)?|gaana bajao|play karo|चालू करो|गाना बजाओ)$/i,
  },
  {
    intent: "media_pause",
    pattern:
      /^(?:pause(?: (?:the )?music)?|gaana roko|gaana band karo|pause karo|रोक दो|गाना रोको|गाना बंद करो)$/i,
  },
  {
    intent: "media_next",
    pattern: /^(?:(?:next|skip)(?: song| track)?|agla gaana|next song karo|अगला गाना)$/i,
  },
  {
    intent: "media_previous",
    pattern: /^(?:(?:previous|last|back)(?: song| track)?|pichhla gaana|पिछला गाना)$/i,
  },
  {
    intent: "shutdown",
    pattern:
      /^(?:shut ?down(?: (?:my|the|this)?\s*(?:pc|computer))?|computer band karo|pc band karo|shutdown karo|कंप्यूटर बंद करो|शट डाउन)$/i,
  },
  {
    intent: "restart",
    pattern:
      /^(?:restart(?: (?:my|the|this)?\s*(?:pc|computer))?|restart karo|रीस्टार्ट करो)$/i,
  },
  {
    intent: "sleep",
    pattern: /^(?:(?:go to )?sleep|sleep mode|sleep karo|स्लीप मोड)$/i,
  },
  {
    intent: "close_application",
    pattern:
      /^(?!(?:aawaz|audio|volume|sound|computer|pc|gaana)\b)(?<app>.+?)\s+(?:band karo|close karo)$/i,
    slotNames: ["app"],
  },
  {
    intent: "close_application",
    pattern: /^बंद करो (?!(?:आवाज़|कंप्यूटर|गाना)\b)(?<app>.+)$/i,
    slotNames: ["app"],
  },
  {
    intent: "open_application",
    pattern: /^(?<app>.+?)\s+(?:kholo|open karo)$/i,
    slotNames: ["app"],
  },
  {
    intent: "open_application",
    pattern: /^खोलो (?<app>.+)$/i,
    slotNames: ["app"],
  },

  // ---- Window management (Tier 1 completion pass, continued; see docs/adr/0029) ----
  { intent: "list_windows", pattern: /^(?:list|show)(?: my| the)?(?: open)? windows$/i },
  {
    intent: "get_active_window",
    pattern: /^(?:what(?:'s| is)(?: the)? active window|which window is (?:active|focused))\??$/i,
  },
  {
    intent: "focus_window",
    pattern: /^(?:switch to|focus(?: on)?|go to) (?<window>.+)$/i,
    slotNames: ["window"],
  },
  { intent: "minimize_window", pattern: /^minimize(?: (?<window>.+))?$/i, slotNames: ["window"] },
  { intent: "maximize_window", pattern: /^maximize(?: (?<window>.+))?$/i, slotNames: ["window"] },
  { intent: "restore_window", pattern: /^restore(?: (?<window>.+))?$/i, slotNames: ["window"] },
  {
    intent: "snap_window",
    pattern: /^snap(?: (?:the )?window)? to (?:the )?(?<position>[a-z-]+)$/i,
    slotNames: ["position"],
  },
  { intent: "switch_window", pattern: /^(?:switch window|alt tab|next window)$/i },

  // ---- Filesystem (Tier 1 completion pass, continued; see docs/adr/0029) ----
  {
    intent: "list_files",
    pattern: /^(?:list|show) files (?:in|at) (?<path>.+)$/i,
    slotNames: ["path"],
  },
  { intent: "read_file", pattern: /^read (?:the )?file (?<path>.+)$/i, slotNames: ["path"] },
  {
    intent: "search_files",
    pattern: /^(?:search|find) (?:for )?files? (?:named |matching )?(?<query>.+)$/i,
    slotNames: ["query"],
  },
  {
    intent: "get_folder_path",
    pattern:
      /^where(?:'s| is)(?: my)? (?<folder>downloads|desktop|documents|pictures|videos|music)(?: folder)?\??$/i,
    slotNames: ["folder"],
  },
  { intent: "list_recent_files", pattern: /^(?:list |show )?recent files$/i },
  {
    intent: "create_folder",
    pattern: /^create (?:a )?folder (?:at |called )?(?<path>.+)$/i,
    slotNames: ["path"],
  },
  {
    intent: "copy_file",
    pattern: /^copy (?<sourcePath>.+?) to (?<destinationPath>.+)$/i,
    slotNames: ["sourcePath", "destinationPath"],
  },
  {
    intent: "move_file",
    pattern: /^move (?<sourcePath>.+?) to (?<destinationPath>.+)$/i,
    slotNames: ["sourcePath", "destinationPath"],
  },
  {
    intent: "rename_file",
    pattern: /^rename (?<path>.+?) to (?<newName>.+)$/i,
    slotNames: ["path", "newName"],
  },
  { intent: "delete_file", pattern: /^delete (?<path>.+)$/i, slotNames: ["path"] },
];

function toResult(action: { ok: boolean; message: string }): VoiceCommandResult {
  return { handled: true, spokenResponse: action.message };
}

/**
 * Registers real handlers for every deterministic desktop command this
 * phase can back with an actual capability — routed through the real,
 * already-built `CapabilityManager` (Platform Capability Layer) and, on
 * Windows, the real `WindowsAdapter` (Windows Agent), via the shared
 * `desktopActions` implementations in `desktop-actions.ts`. As of
 * `docs/adr/0030`, this now includes real OS power management
 * (shutdown/restart/sleep, gated behind `DestructiveActionGate`) and
 * the universal open capability (open_url/open_file/open_folder/
 * smart_open, with real per-browser resolution). Commands the brief
 * lists that still have no backing capability anywhere in this
 * repository (WhatsApp, email, PDF/image editing — no package for any
 * of these exists) remain registered with the real, already-built
 * `notYetImplementedHandler()` rather than a fabricated success
 * response, wherever they're added in the future.
 */
export function registerDesktopVoiceCommands(
  router: { register(handler: VoiceCommandHandler): void },
  capabilityManager: CapabilityManager,
  powerConfirmation: PowerConfirmationManager,
  contextTracker?: ContextReferenceTracker,
  actorId = "voice-session",
  /** Same real, live Settings read as `buildDesktopToolDefinitions` — see its docstring. */
  getPreferredBrowser?: () => string | undefined,
): void {
  router.register({
    intent: "open_application",
    handle: async (match) =>
      toResult(
        await desktopActions.openApplication(
          capabilityManager,
          actorId,
          match.slots["app"],
          contextTracker,
          getPreferredBrowser?.(),
        ),
      ),
  });

  router.register({
    intent: "close_application",
    handle: async (match) =>
      toResult(
        await desktopActions.closeApplication(capabilityManager, actorId, match.slots["app"]),
      ),
  });

  router.register({
    intent: "volume_up",
    handle: async () => toResult(await desktopActions.volumeUp(capabilityManager, actorId)),
  });

  router.register({
    intent: "volume_down",
    handle: async (match) => {
      const percent = match.slots["percent"] ? Number(match.slots["percent"]) : undefined;
      return toResult(await desktopActions.volumeDown(capabilityManager, actorId, percent));
    },
  });

  router.register({
    intent: "set_volume",
    handle: async (match) =>
      toResult(
        await desktopActions.setVolume(
          capabilityManager,
          actorId,
          Number(match.slots["percent"] ?? match.slots["percent2"]),
        ),
      ),
  });

  router.register({
    intent: "mute",
    handle: async () => toResult(await desktopActions.mute(capabilityManager, actorId)),
  });

  router.register({
    intent: "unmute",
    handle: async () => toResult(await desktopActions.unmute(capabilityManager, actorId)),
  });

  const mediaIntents = ["media_play", "media_pause", "media_next", "media_previous"] as const;
  const mediaActionByIntent: Record<
    (typeof mediaIntents)[number],
    "play" | "pause" | "next" | "previous"
  > = {
    media_play: "play",
    media_pause: "pause",
    media_next: "next",
    media_previous: "previous",
  };
  for (const intent of mediaIntents) {
    router.register({
      intent,
      handle: async () =>
        toResult(
          await desktopActions.mediaControl(
            capabilityManager,
            actorId,
            mediaActionByIntent[intent],
          ),
        ),
    });
  }

  // OS power management (see docs/adr/0030) — real, gated behind the
  // real DestructiveActionGate (see PowerManager). No longer stubbed.
  router.register({
    intent: "shutdown",
    handle: async () =>
      toResult(await desktopActions.shutdown(capabilityManager, actorId, powerConfirmation)),
  });
  router.register({
    intent: "restart",
    handle: async () =>
      toResult(await desktopActions.restart(capabilityManager, actorId, powerConfirmation)),
  });
  router.register({
    intent: "sleep",
    handle: async () =>
      toResult(await desktopActions.sleep(capabilityManager, actorId, powerConfirmation)),
  });

  // ---- Universal open capability (see docs/adr/0030) ----
  router.register({
    intent: "open_url",
    handle: async (match) =>
      toResult(
        await desktopActions.openUrl(
          capabilityManager,
          actorId,
          match.slots["url"],
          match.slots["browser"],
          contextTracker,
          getPreferredBrowser?.(),
        ),
      ),
  });
  router.register({
    intent: "open_file",
    handle: async (match) =>
      toResult(
        await desktopActions.openFile(
          capabilityManager,
          actorId,
          match.slots["path"],
          contextTracker,
        ),
      ),
  });
  router.register({
    intent: "open_folder",
    handle: async (match) =>
      toResult(
        await desktopActions.openFolder(
          capabilityManager,
          actorId,
          match.slots["path"],
          contextTracker,
        ),
      ),
  });
  router.register({
    intent: "open_this",
    handle: async () => {
      if (!contextTracker) {
        return {
          handled: true,
          spokenResponse: "I don't have a file, folder, or link to open right now.",
        };
      }
      return toResult(
        await desktopActions.openContextualReference(
          capabilityManager,
          actorId,
          contextTracker,
          getPreferredBrowser?.(),
        ),
      );
    },
  });

  // ---- Window management (Tier 1 completion pass, continued; see docs/adr/0029) ----
  router.register({
    intent: "list_windows",
    handle: async () => toResult(await desktopActions.listWindows(capabilityManager, actorId)),
  });
  router.register({
    intent: "get_active_window",
    handle: async () => toResult(await desktopActions.getActiveWindow(capabilityManager, actorId)),
  });
  router.register({
    intent: "focus_window",
    handle: async (match) =>
      toResult(await desktopActions.focusWindow(capabilityManager, actorId, match.slots["window"])),
  });
  router.register({
    intent: "minimize_window",
    handle: async (match) =>
      toResult(
        await desktopActions.minimizeWindow(capabilityManager, actorId, match.slots["window"]),
      ),
  });
  router.register({
    intent: "maximize_window",
    handle: async (match) =>
      toResult(
        await desktopActions.maximizeWindow(capabilityManager, actorId, match.slots["window"]),
      ),
  });
  router.register({
    intent: "restore_window",
    handle: async (match) =>
      toResult(
        await desktopActions.restoreWindow(capabilityManager, actorId, match.slots["window"]),
      ),
  });
  router.register({
    intent: "snap_window",
    handle: async (match) =>
      toResult(
        await desktopActions.snapWindow(
          capabilityManager,
          actorId,
          match.slots["position"],
          undefined,
        ),
      ),
  });
  router.register({
    intent: "switch_window",
    handle: async () => toResult(await desktopActions.switchWindow(capabilityManager, actorId)),
  });

  // ---- Filesystem (Tier 1 completion pass, continued; see docs/adr/0029) ----
  router.register({
    intent: "list_files",
    handle: async (match) =>
      toResult(await desktopActions.listFiles(capabilityManager, actorId, match.slots["path"])),
  });
  router.register({
    intent: "read_file",
    handle: async (match) =>
      toResult(await desktopActions.readFile(capabilityManager, actorId, match.slots["path"])),
  });
  router.register({
    intent: "search_files",
    handle: async (match) =>
      toResult(
        await desktopActions.searchFiles(
          capabilityManager,
          actorId,
          match.slots["query"],
          undefined,
        ),
      ),
  });
  router.register({
    intent: "get_folder_path",
    handle: async (match) =>
      toResult(
        await desktopActions.getFolderPath(capabilityManager, actorId, match.slots["folder"]),
      ),
  });
  router.register({
    intent: "list_recent_files",
    handle: async () => toResult(await desktopActions.listRecentFiles(capabilityManager, actorId)),
  });
  router.register({
    intent: "create_folder",
    handle: async (match) =>
      toResult(await desktopActions.createFolder(capabilityManager, actorId, match.slots["path"])),
  });
  router.register({
    intent: "copy_file",
    handle: async (match) =>
      toResult(
        await desktopActions.copyFile(
          capabilityManager,
          actorId,
          match.slots["sourcePath"],
          match.slots["destinationPath"],
        ),
      ),
  });
  router.register({
    intent: "move_file",
    handle: async (match) =>
      toResult(
        await desktopActions.moveFile(
          capabilityManager,
          actorId,
          match.slots["sourcePath"],
          match.slots["destinationPath"],
        ),
      ),
  });
  router.register({
    intent: "rename_file",
    handle: async (match) =>
      toResult(
        await desktopActions.renameFile(
          capabilityManager,
          actorId,
          match.slots["path"],
          match.slots["newName"],
        ),
      ),
  });
  router.register({
    intent: "delete_file",
    handle: async (match) =>
      toResult(
        await desktopActions.deleteFile(
          capabilityManager,
          actorId,
          match.slots["path"],
          contextTracker,
        ),
      ),
  });
}

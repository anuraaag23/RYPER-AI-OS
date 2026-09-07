import { createLogger } from "@ryper/logging";
import type { AIOrchestrator } from "@ryper/ai-engine";
import type { CapabilityManager } from "@ryper/platform-capability";
import type { DeviceState } from "@ryper/model-router";
import {
  tryResolvePowerConfirmation,
  type PowerAction,
  type PowerConfirmationManager,
} from "./power-confirmation.js";
import { desktopActions } from "./desktop-actions.js";
import type { ToolActivityEntry, TurnProgressStage } from "./ipc-contract.js";
import { createToolActivityCollector } from "./tool-activity.js";

const log = createLogger("desktop-app:text-chat");

export type TurnProgressCallback = (progress: {
  readonly stage: TurnProgressStage;
  readonly label: string;
}) => void;

function describeToolProgress(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "open_application": {
      const app = typeof args["app"] === "string" ? args["app"].trim() : "";
      return app ? `Opening ${app}…` : "Opening application…";
    }
    case "close_application": {
      const app = typeof args["app"] === "string" ? args["app"].trim() : "";
      return app ? `Closing ${app}…` : "Closing application…";
    }
    case "get_power_info":
      return "Checking your battery…";
    case "volume_up":
    case "volume_down":
    case "set_volume":
    case "mute":
    case "unmute":
      return "Adjusting volume…";
    case "list_files":
    case "read_file":
    case "search_files":
    case "get_folder_path":
      return "Checking files…";
    case "list_windows":
    case "get_active_window":
    case "focus_window":
    case "switch_window":
      return "Finding window…";
    case "get_system_info":
    case "list_displays":
    case "list_devices":
      return "Checking system info…";
    case "open_url":
    case "smart_open":
      return "Opening link…";
    default:
      return "Using your PC…";
  }
}

/**
 * Closes the most severe gap found during the Tier 1 UI-integration
 * pass (see docs/adr/0032): the desktop app's text chat
 * (`ipc-handlers.ts`'s `sendTurn`/`regenerateMessage`) previously
 * routed through `@ryper/web-shell`'s `ConversationEngine`, constructed
 * with **no real model providers** (`createWebShell()` was called with
 * zero arguments in `core-bootstrap.ts`) — every text message
 * genuinely received the literal placeholder string
 * `"[local model] <the user's message>"` back, regardless of what was
 * actually typed, and had no access to any real capability/tool at
 * all. This function is the real replacement: it routes a text message
 * through the *same* `AIOrchestrator` instance voice already uses
 * (shared via `VoiceBundle`, see `voice-bootstrap.ts`), including the
 * same real tool-calling, and the same power-action confirmation flow
 * — a typed "shut down my pc" now genuinely asks for confirmation, and
 * a typed "yes" genuinely resolves it, exactly like the spoken version.
 */
export interface TextTurnResult {
  readonly reply: string;
  /** Real tool calls made during this turn — see `summarizeForDisplay()`. Empty when none. */
  readonly toolActivity: readonly ToolActivityEntry[];
  /** True when this result reflects a genuine user cancellation, not a model reply. */
  readonly cancelled?: boolean;
  /**
   * Best-effort, not per-call-instrumented (see docs/adr/0032's honest
   * note): reflects whether a real cloud provider is configured *and*
   * the device is online, since `AIOrchestrator` doesn't currently
   * report which specific provider generated a given reply back to its
   * caller. `"local"` also covers the real, on-device
   * `HeuristicToolCallingProvider` fallback — it never leaves the
   * machine, so "local" remains an honest description even when no
   * real LLM is active.
   */
  readonly routingTarget: "local" | "cloud";
}

export interface TextTurnDeps {
  readonly orchestrator: AIOrchestrator;
  readonly capabilityManager: CapabilityManager;
  readonly powerConfirmation: PowerConfirmationManager;
  readonly cloudLLMConfigured: boolean;
}

/**
 * `conversationId` doubles as the `AIOrchestrator` session id — the
 * same real session/context-window machinery
 * (`SessionManager.getOrCreate`) that voice turns use, keyed
 * consistently with how conversations are already identified
 * throughout this app.
 */
export async function runTextTurn(
  conversationId: string,
  content: string,
  device: DeviceState,
  deps: TextTurnDeps,
  signal?: AbortSignal,
  onProgress?: TurnProgressCallback,
): Promise<TextTurnResult> {
  const routingTarget: "local" | "cloud" =
    deps.cloudLLMConfigured && device.online ? "cloud" : "local";

  onProgress?.({ stage: "thinking", label: "Thinking…" });

  let warmupTimer: NodeJS.Timeout | undefined;
  let hasReceivedFirstActivity = false;

  if (routingTarget === "local" && onProgress) {
    warmupTimer = setTimeout(() => {
      if (!hasReceivedFirstActivity) {
        onProgress({
          stage: "warmup",
          label: "The local AI is warming up. This can take a little longer the first time.",
        });
      }
    }, 7_000);
  }

  const clearWarmup = () => {
    if (warmupTimer) {
      clearTimeout(warmupTimer);
      warmupTimer = undefined;
    }
  };

  const confirmation = await tryResolvePowerConfirmation(
    content,
    deps.powerConfirmation,
    (action: PowerAction) =>
      desktopActions.executeConfirmedPowerAction(deps.capabilityManager, "ai-orchestrator", action),
    signal,
  );
  if (confirmation) {
    clearWarmup();
    return { reply: confirmation.reply, routingTarget, toolActivity: [] };
  }

  let text = "";
  let sawError = false;
  let errorMessage: string | undefined;
  let hasCompletedTool = false;
  let lastExecutedTool: string | undefined;
  const toolActivity = createToolActivityCollector();

  try {
    for await (const event of deps.orchestrator.sendMessage(conversationId, content, {
      device,
      ...(signal ? { signal } : {}),
    })) {
      if (!hasReceivedFirstActivity) {
        hasReceivedFirstActivity = true;
        clearWarmup();
      }

      toolActivity.onEvent(event);
      if (event.type === "text_delta") {
        if (text.length === 0) {
          onProgress?.({ stage: "generating", label: "Finishing up…" });
        }
        text += event.delta;
      } else if (event.type === "tool_call") {
        log.info("AI orchestrator invoking tool", { name: event.toolCall.name });
        let parsedArgs: Record<string, unknown> = {};
        if (typeof event.toolCall.arguments === "string") {
          try {
            parsedArgs = JSON.parse(event.toolCall.arguments) as Record<string, unknown>;
          } catch {
            // Fallback to empty
          }
        } else if (
          typeof event.toolCall.arguments === "object" &&
          event.toolCall.arguments !== null
        ) {
          parsedArgs = event.toolCall.arguments as Record<string, unknown>;
        }
        const label = describeToolProgress(event.toolCall.name, parsedArgs);
        onProgress?.({ stage: "tool", label });
      } else if (event.type === "tool_result") {
        if (!event.ok) {
          log.warn("tool call failed", { name: event.name, content: event.content });
        } else {
          hasCompletedTool = true;
          lastExecutedTool = event.name;
        }
        onProgress?.({ stage: "tool", label: "Working on it…" });
      } else if (event.type === "error") {
        sawError = true;
        errorMessage = event.message;
        log.warn("AI orchestrator reported an error", { message: event.message });
      }
    }
  } catch (err) {
    clearWarmup();
    const aborted =
      signal?.aborted === true ||
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && err.name === "AbortError");
    if (aborted) {
      log.info("text turn cancelled by user", { conversationId });
      return {
        reply: "Cancelled.",
        routingTarget,
        toolActivity: toolActivity.entries,
        cancelled: true,
      };
    }
    if (hasCompletedTool && lastExecutedTool) {
      const toolErr = new Error(
        `action_completed:${lastExecutedTool}:${err instanceof Error ? err.message : String(err)}`,
      );
      throw toolErr;
    }
    throw err;
  } finally {
    clearWarmup();
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    if (hasCompletedTool && lastExecutedTool) {
      throw new Error(
        `action_completed:${lastExecutedTool}:${sawError ? errorMessage ?? "unknown" : "empty response"}`,
      );
    }
    throw new Error(
      sawError
        ? `the AI orchestrator reported an error: ${errorMessage ?? "unknown"}`
        : "the AI orchestrator returned an empty response",
    );
  }
  return { reply: trimmed, routingTarget, toolActivity: toolActivity.entries };
}

import type {
  VoiceCommandContext,
  VoiceCommandHandler,
  VoiceCommandMatch,
  VoiceCommandResult,
} from "@ryper/voice-engine";
import type { ToolPlatform, ToolResult } from "./types.js";

/** The minimal surface `createToolVoiceCommandHandler` needs — satisfied structurally by `ToolManager`. */
export interface ToolInvoker {
  invoke(
    toolId: string,
    parameters: Readonly<Record<string, unknown>>,
    actorId: string,
    sessionId: string,
    platform: ToolPlatform,
  ): Promise<ToolResult>;
}

function parseParameters(raw: string | undefined): Readonly<Record<string, unknown>> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function describeResult(toolId: string, result: ToolResult): string {
  if (result.status === "ok") return `Done — ran ${toolId} successfully.`;
  if (result.status === "permission_denied") return `I don't have permission to run ${toolId} yet.`;
  if (result.status === "timeout") return `${toolId} took too long and timed out.`;
  return `${toolId} didn't complete: ${result.errorMessage ?? result.status}.`;
}

/**
 * A real `VoiceCommandHandler` (the exact interface
 * `VoiceCommandRouter.register()` expects) that resolves a matched
 * intent's `tool` slot to a tool invocation. Voice commands become tool
 * invocations through this framework rather than through a separate
 * voice-specific execution path — the brief's "voice commands should
 * resolve to tool invocations through this framework," implemented as a
 * thin adapter rather than a parallel dispatcher.
 */
export function createToolVoiceCommandHandler(
  invoker: ToolInvoker,
  platform: ToolPlatform,
  intent = "invoke_tool",
): VoiceCommandHandler {
  return {
    intent,
    async handle(
      match: VoiceCommandMatch,
      context: VoiceCommandContext,
    ): Promise<VoiceCommandResult> {
      const toolId = match.slots["tool"];
      if (!toolId) {
        return { handled: true, spokenResponse: "I'm not sure which tool you'd like me to run." };
      }
      const parameters = parseParameters(match.slots["parameters"]);
      const result = await invoker.invoke(
        toolId,
        parameters,
        "voice-user",
        context.sessionId,
        platform,
      );
      return { handled: true, spokenResponse: describeResult(toolId, result) };
    },
  };
}

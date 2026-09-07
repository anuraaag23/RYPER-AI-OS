import type { StreamEvent } from "@ryper/ai-engine";
import type { ToolActivityEntry } from "./ipc-contract.js";

const SENSITIVE_KEY_PATTERN = /pass(word)?|secret|token|credential|api[_-]?key|auth/i;
const MAX_SUMMARY_LENGTH = 400;

/**
 * Builds a safe, user-facing string for a tool's arguments or result —
 * never the raw internal object. Keys that look like they carry a
 * secret/credential are redacted rather than displayed (Tier 1 UI
 * brief sections 9/12: tool visibility must never leak sensitive
 * internal data), and the whole string is truncated so a large
 * file/document payload can't flood the conversation view.
 *
 * Shared by both `text-chat.ts` and `voice-pipeline.ts` so a tool call
 * made by voice and one made by typing are described identically, and
 * so the redaction rule only needs to be reasoned about in one place.
 */
export function summarizeForDisplay(value: unknown): string {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      const redacted = JSON.parse(
        JSON.stringify(value, (key, v) => (SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : v)),
      ) as unknown;
      text = JSON.stringify(redacted);
    } catch {
      text = String(value);
    }
  }
  if (
    text.includes("was not granted for actor") ||
    text.includes("is not granted to actor") ||
    (text.includes("capability") && text.includes("not granted"))
  ) {
    return "Permission was denied by the user. The action was cancelled.";
  }
  return text.length > MAX_SUMMARY_LENGTH ? `${text.slice(0, MAX_SUMMARY_LENGTH)}…` : text;
}

/**
 * Incrementally builds a `ToolActivityEntry[]` from an `AIOrchestrator`
 * stream, matching each `tool_result` back to the `tool_call` that
 * requested it by `toolCallId`. Call `onEvent()` for every event in
 * the stream (tool-related or not) — it only appends when a genuine
 * `tool_result` arrives, and is a no-op for every other event type, so
 * a caller can layer this on top of its own per-event handling without
 * re-deriving tool state.
 */
export function createToolActivityCollector(): {
  readonly entries: ToolActivityEntry[];
  onEvent(event: StreamEvent): void;
} {
  const pendingCalls = new Map<string, { name: string; argsSummary: string }>();
  const entries: ToolActivityEntry[] = [];
  return {
    entries,
    onEvent(event: StreamEvent): void {
      if (event.type === "tool_call") {
        pendingCalls.set(event.toolCall.id, {
          name: event.toolCall.name,
          argsSummary: summarizeForDisplay(event.toolCall.arguments),
        });
      } else if (event.type === "tool_result") {
        const call = pendingCalls.get(event.toolCallId);
        entries.push({
          toolCallId: event.toolCallId,
          name: call?.name ?? event.name,
          argsSummary: call?.argsSummary ?? "",
          ok: event.ok,
          resultSummary: summarizeForDisplay(event.content),
        });
      }
    },
  };
}

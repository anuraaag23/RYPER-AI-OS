import { createLogger } from "@ryper/logging";
import type { ConversationStore } from "./conversation-store.js";
import type { ToolActivityEntry } from "./ipc-contract.js";

const log = createLogger("desktop-app:voice-turn-recorder");

/** Title of the real, always-available conversation voice turns are recorded into. */
export const VOICE_CONVERSATION_TITLE = "Voice";

export interface VoiceTurnRecorderDeps {
  readonly conversations: Pick<ConversationStore, "getOrCreateByTitle" | "appendMessage">;
  /** Called with the conversation id after a successful persist, so the renderer can be told to refresh. */
  readonly onRecorded: (conversationId: string) => void;
}

export type VoiceTurnRecorder = (
  transcript: string,
  spokenResponse: string,
  toolActivity: readonly ToolActivityEntry[],
) => Promise<void>;

/**
 * Persists a completed voice turn into the same `ConversationStore`
 * text chat uses (Tier 1 UI brief section I — "conversation
 * rendering"): previously a spoken exchange existed only as TTS audio
 * and a `VoiceContextManager` memory entry, invisible in the chat
 * window's persisted history.
 *
 * Deliberately takes its `ConversationStore` and notify callback as
 * plain injected dependencies rather than reading module-level
 * globals (as `main.ts` otherwise would for `core`/`mainWindow`) so
 * this can be unit-tested directly, without mocking Electron's `app`/
 * `BrowserWindow`/`ipcMain` — see `voice-turn-recorder.test.ts`.
 *
 * Best-effort: a persistence failure is logged, not thrown, since the
 * turn itself already completed and spoke successfully — losing the
 * history record is real but strictly less bad than crashing the app
 * over it.
 */
export function createVoiceTurnRecorder(deps: VoiceTurnRecorderDeps): VoiceTurnRecorder {
  return async function recordVoiceTurn(transcript, spokenResponse, toolActivity) {
    try {
      const conversation = await deps.conversations.getOrCreateByTitle(VOICE_CONVERSATION_TITLE);
      await deps.conversations.appendMessage(conversation.id, "user", transcript);
      await deps.conversations.appendMessage(
        conversation.id,
        "assistant",
        spokenResponse,
        undefined,
        toolActivity,
      );
      deps.onRecorded(conversation.id);
    } catch (err) {
      log.warn("failed to record voice turn in conversation history", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

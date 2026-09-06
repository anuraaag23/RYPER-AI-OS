import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble.js";
import { Composer } from "./Composer.js";
import { VoiceOrb } from "./VoiceOrb.js";
import { useMessages, useVoiceState, useCurrentReference } from "../hooks/useRyperData.js";

export interface ChatPanelProps {
  readonly conversationId: string | undefined;
}

/** Short, honest label for what "open this"/"play this" currently refers to — never invents a display name. */
export function describeReference(reference: {
  readonly type: string;
  readonly path?: string;
  readonly url?: string;
  readonly name?: string;
}): string {
  const label = reference.name ?? reference.path ?? reference.url ?? "something";
  const kind =
    reference.type === "folder"
      ? "folder"
      : reference.type === "url"
        ? "page"
        : reference.type === "application"
          ? "app"
          : reference.type === "media"
            ? "media"
            : "file";
  return `Referring to this ${kind}: ${label}`;
}

export function ChatPanel({ conversationId }: ChatPanelProps): JSX.Element {
  const { messages, send, remove, regenerate, sending, error, clearError, cancel } =
    useMessages(conversationId);
  const voice = useVoiceState();
  const currentReference = useCurrentReference(messages.length);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const onOrbPress = (): void => {
    if (voice.status === "idle") void window.ryper.startVoiceTurn();
    else void window.ryper.stopVoiceTurn();
  };

  if (!conversationId) {
    return (
      <div className="chat-panel chat-panel--empty">
        <VoiceOrb state={voice.status} connection={voice.connection} onPress={onOrbPress} />
        <p>Select or start a conversation to begin.</p>
      </div>
    );
  }

  return (
    <div className="chat-panel">
      <div
        className="message-list"
        ref={listRef}
        role="log"
        aria-label="Conversation"
        aria-live="polite"
      >
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            onDelete={(id) => void remove(id)}
            onRegenerate={(id) => void regenerate(id)}
          />
        ))}
        {sending && (
          <div className="message message--assistant message--pending">
            <span>Thinking…</span>
            <button type="button" className="turn-cancel" onClick={cancel}>
              Cancel
            </button>
          </div>
        )}
      </div>
      {error && (
        <div className="error-banner" role="alert">
          <span className="error-banner-message">{error}</span>
          <button type="button" onClick={clearError} aria-label="Dismiss error">
            Dismiss
          </button>
        </div>
      )}
      {currentReference && (
        <div
          className="context-reference-chip"
          title={currentReference.path ?? currentReference.url ?? ""}
          aria-live="polite"
        >
          {describeReference(currentReference)}
        </div>
      )}
      <div className="chat-panel-footer">
        <VoiceOrb state={voice.status} connection={voice.connection} onPress={onOrbPress} />
        <Composer onSend={(content) => void send(content)} disabled={sending} />
      </div>
    </div>
  );
}

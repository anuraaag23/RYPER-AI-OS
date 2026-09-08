import { useEffect, useRef, useState } from "react";
import { MessageBubble } from "./MessageBubble.js";
import { Composer } from "./Composer.js";
import { VoiceOrb } from "./VoiceOrb.js";
import {
  useMessages,
  useVoiceState,
  useAudioStatus,
  useCurrentReference,
  useAIStatus,
} from "../hooks/useRyperData.js";

export interface ChatPanelProps {
  readonly conversationId: string | undefined;
  readonly onStartConversation?: (initialMessage?: string) => void;
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

export function ChatPanel({ conversationId, onStartConversation }: ChatPanelProps): JSX.Element {
  const {
    messages,
    send,
    remove,
    regenerate,
    sending,
    progress,
    error,
    canRetry,
    retry,
    clearError,
    cancel,
  } = useMessages(conversationId);
  const voice = useVoiceState();
  const audioStatus = useAudioStatus();
  const aiStatus = useAIStatus();
  const currentReference = useCurrentReference(messages.length);
  const listRef = useRef<HTMLDivElement>(null);
  const statusContainerRef = useRef<HTMLDivElement>(null);

  const [showStatusPopover, setShowStatusPopover] = useState(false);
  const [isLongWait, setIsLongWait] = useState(false);
  const [restartingAI, setRestartingAI] = useState(false);

  const handleRestartLocalAI = async (): Promise<void> => {
    setRestartingAI(true);
    try {
      const res = await window.ryper.restartLocalAI();
      if (res.ok) {
        retry();
      }
    } catch {
      // safe fallback
    } finally {
      setRestartingAI(false);
    }
  };

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  // Dismiss AI status popover on Escape or click outside
  useEffect(() => {
    if (!showStatusPopover) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowStatusPopover(false);
    };
    const onClickOutside = (e: MouseEvent) => {
      if (statusContainerRef.current && !statusContainerRef.current.contains(e.target as Node)) {
        setShowStatusPopover(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onClickOutside);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onClickOutside);
    };
  }, [showStatusPopover]);

  // P2-2: Elapsed-time awareness during genuinely long local inference (>12s)
  useEffect(() => {
    if (!sending) {
      setIsLongWait(false);
      return;
    }
    const timer = setTimeout(() => {
      setIsLongWait(true);
    }, 12000);
    return () => clearTimeout(timer);
  }, [sending]);

  const onOrbPress = (): void => {
    if (voice.status === "idle") void window.ryper.startVoiceTurn();
    else void window.ryper.stopVoiceTurn();
  };

  const handleSend = (content: string): void => {
    if (conversationId) {
      void send(content);
    } else if (onStartConversation) {
      onStartConversation(content);
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-panel-header">
        <div className="ai-status-container" ref={statusContainerRef}>
          <button
            type="button"
            className="ai-status-indicator"
            role="status"
            aria-label={`AI Status: ${aiStatus.label}`}
            aria-expanded={showStatusPopover}
            aria-haspopup="dialog"
            onClick={() => setShowStatusPopover((prev) => !prev)}
            title="Click for local AI details"
          >
            <span className="ai-status-dot" aria-hidden="true" />
            <span className="ai-status-text">{aiStatus.label}</span>
            <svg
              className={`ai-status-chevron ${showStatusPopover ? "ai-status-chevron--open" : ""}`}
              viewBox="0 0 16 16"
              width="12"
              height="12"
              aria-hidden="true"
            >
              <path
                d="M4 6l4 4 4-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {showStatusPopover && (
            <div
              className="ai-status-popover glass"
              role="dialog"
              aria-label="Local AI status details"
            >
              <div className="ai-status-popover-header">
                <span className="ai-status-popover-title">{aiStatus.label}</span>
                {aiStatus.readinessState === "ready" && (
                  <span className="ai-status-badge ai-status-badge--ready">Ready</span>
                )}
                {aiStatus.readinessState === "missing" && (
                  <span className="ai-status-badge ai-status-badge--missing">Setup Needed</span>
                )}
                {aiStatus.readinessState === "failed" && (
                  <span className="ai-status-badge ai-status-badge--failed">Unavailable</span>
                )}
              </div>
              <ul className="ai-status-popover-list">
                <li>
                  <span className="ai-status-popover-icon" aria-hidden="true">🔒</span>
                  <div>
                    <strong>On-Device & Private:</strong> Running locally on your computer. Your conversations never leave your device.
                  </div>
                </li>
                <li>
                  <span className="ai-status-popover-icon" aria-hidden="true">📶</span>
                  <div>
                    <strong>Works Offline:</strong> Full AI intelligence is available without an active internet connection.
                  </div>
                </li>
                <li>
                  <span className="ai-status-popover-icon" aria-hidden="true">⚡</span>
                  <div>
                    <strong>First-Turn Startup:</strong> The first response may take a little longer while the local model warms up in memory.
                  </div>
                </li>
              </ul>
              {aiStatus.readinessState === "missing" && (
                <div className="ai-status-popover-action">
                  <p className="ai-status-action-text">
                    Local model setup is incomplete. Check requirements in Diagnostics.
                  </p>
                  <button
                    type="button"
                    className="ai-status-action-btn"
                    onClick={() => void window.ryper.openSettingsWindow()}
                  >
                    Open Diagnostics
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div
        className="message-list"
        ref={listRef}
        role="log"
        aria-label="Conversation"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <div className="welcome-hero" role="region" aria-label="Welcome">
            <h2 className="welcome-title">Hi, I'm RYPER.</h2>
            <p className="welcome-subtitle">
              I can answer questions, work with your Windows PC, manage files and apps, and talk with you by voice.
            </p>
            <p className="welcome-prompt">Try asking me something:</p>
            <div className="suggestion-chips" role="group" aria-label="Suggested prompts">
              <button
                type="button"
                className="suggestion-chip"
                onClick={() => handleSend("Check my battery")}
              >
                Check my battery
              </button>
              <button
                type="button"
                className="suggestion-chip"
                onClick={() => handleSend("Open Notepad")}
              >
                Open Notepad
              </button>
              <button
                type="button"
                className="suggestion-chip"
                onClick={() => handleSend("What can you do?")}
              >
                What can you do?
              </button>
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            onDelete={(id) => void remove(id)}
            onRegenerate={(id) => void regenerate(id)}
          />
        ))}
        {sending && (
          <div
            className="message message--assistant message--pending"
            role="status"
            aria-live="polite"
          >
            <div className="pending-content">
              <div className="pending-main">
                <span className="pending-pulse" aria-hidden="true" />
                <span className="pending-label">{progress?.label ?? "Thinking…"}</span>
              </div>
              {isLongWait && (
                <div className="pending-reassurance" aria-live="polite">
                  Still working — local AI can take a little longer for complex requests.
                </div>
              )}
            </div>
            <button type="button" className="turn-cancel" onClick={cancel}>
              Cancel
            </button>
          </div>
        )}
      </div>
      {error && (
        <div className="error-banner" role="alert">
          <span className="error-banner-message">{error}</span>
          <div className="error-banner-actions">
            {canRetry && (
              <button
                type="button"
                className="error-retry-btn"
                onClick={retry}
                aria-label="Retry request"
              >
                Retry
              </button>
            )}
            {canRetry && error.includes("isn't responding") && (
              <button
                type="button"
                className="error-restart-btn"
                onClick={() => void handleRestartLocalAI()}
                disabled={restartingAI}
                aria-label="Restart local AI"
              >
                {restartingAI ? "Restarting…" : "Restart Local AI"}
              </button>
            )}
            <button type="button" onClick={clearError} aria-label="Dismiss error">
              Dismiss
            </button>
          </div>
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
        <VoiceOrb
          state={voice.status}
          connection={voice.connection}
          micStatus={audioStatus?.microphone}
          onPress={onOrbPress}
        />
        <Composer onSend={handleSend} disabled={sending} />
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import type { StoredMessage } from "../../electron/ipc-contract.js";
import { renderMarkdown } from "../lib/markdown.js";

export interface MessageBubbleProps {
  readonly message: StoredMessage;
  readonly onDelete: (id: string) => void;
  readonly onRegenerate: (id: string) => void;
}

export function formatToolName(name: string): string {
  const map: Record<string, string> = {
    system_run_app: "Open Application",
    open_application: "Open Application",
    close_application: "Close Application",
    system_power_query: "Check Power Status",
    system_power_set: "Power Action",
    get_power_info: "Check Power Status",
    system_volume_set: "Adjust Volume",
    system_volume_query: "Check Volume",
    set_volume: "Adjust Volume",
    volume_up: "Volume Up",
    volume_down: "Volume Down",
    mute: "Mute Audio",
    unmute: "Unmute Audio",
    system_open_file: "Open File",
    system_browser_open: "Open Browser",
    open_url: "Open Browser",
    system_clipboard_read: "Read Clipboard",
    system_clipboard_write: "Copy to Clipboard",
    device_media_control: "Media Control",
    file_search: "Find Files",
    search_files: "Find Files",
    read_text_file: "Read File",
    read_file: "Read File",
    list_files: "List Files",
    list_windows: "List Windows",
    focus_window: "Switch Window",
  };
  if (map[name]) return map[name];
  return name
    .replace(/^system_/, "")
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function MessageBubble({
  message,
  onDelete,
  onRegenerate,
}: MessageBubbleProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const html = useMemo(() => renderMarkdown(message.content), [message.content]);

  const copy = (): void => {
    void navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={`message message--${message.role}`}>
      <div
        className={`message-bubble glass ${message.role === "user" ? "message-bubble--user" : ""}`}
      >
        <span className="glass-highlight" />
        {/* html is sanitized in renderMarkdown() via DOMPurify before being set here */}
        <div className="message-content" dangerouslySetInnerHTML={{ __html: html }} />
        {message.cancelled && <div className="message-cancelled-note">Cancelled by you</div>}
        {message.toolActivity && message.toolActivity.length > 0 && (
          <div className="tool-activity">
            {message.toolActivity.map((tool) => (
              <details
                key={tool.toolCallId}
                className={`tool-activity-item tool-activity-item--${tool.ok ? "ok" : "failed"}`}
              >
                <summary>
                  <span className="tool-activity-status" aria-hidden="true">
                    {tool.ok ? "✓" : "✗"}
                  </span>
                  <span className="tool-activity-name" title={tool.name}>
                    {formatToolName(tool.name)}
                  </span>
                  <span className="tool-activity-label">{tool.ok ? "succeeded" : "failed"}</span>
                </summary>
                <div className="tool-activity-detail">
                  <div>
                    <strong>Arguments:</strong> <code>{tool.argsSummary || "(none)"}</code>
                  </div>
                  <div>
                    <strong>Result:</strong> <code>{tool.resultSummary}</code>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
      <div className="message-actions">
        <button type="button" onClick={copy} aria-label="Copy message">
          {copied ? "Copied" : "Copy"}
        </button>
        {message.role === "assistant" && (
          <button
            type="button"
            onClick={() => onRegenerate(message.id)}
            aria-label="Regenerate response"
          >
            Regenerate
          </button>
        )}
        <button type="button" onClick={() => onDelete(message.id)} aria-label="Delete message">
          Delete
        </button>
        {message.routingTarget && (
          <span
            className={`message-routing message-routing--${message.routingTarget}`}
            title={message.routingTarget === "local" ? "Processed on this device" : "Processed in cloud"}
          >
            {message.routingTarget === "local" ? "🔒 On-Device (Private)" : "☁️ Cloud AI"}
          </span>
        )}
      </div>
    </div>
  );
}

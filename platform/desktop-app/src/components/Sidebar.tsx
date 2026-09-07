import { useState } from "react";
import type { ConversationSummary } from "../../electron/ipc-contract.js";

export interface SidebarProps {
  readonly conversations: readonly ConversationSummary[];
  readonly activeId: string | undefined;
  readonly onSelect: (id: string) => void;
  readonly onCreate: () => void;
  readonly onRename: (id: string, title: string) => void;
  readonly onArchive: (id: string, archived: boolean) => void;
  readonly onDelete: (id: string) => void;
  readonly onOpenSettings: () => void;
}



export function Sidebar(props: SidebarProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [editValue, setEditValue] = useState("");

  const visible = props.conversations.filter(
    (c) => !c.archived && c.title.toLowerCase().includes(query.toLowerCase()),
  );
  const pinned = visible.filter((c) => c.pinned);
  const recent = visible.filter((c) => !c.pinned);

  const startEditing = (c: ConversationSummary): void => {
    setEditingId(c.id);
    setEditValue(c.title);
  };

  const commitEditing = (): void => {
    if (editingId) props.onRename(editingId, editValue.trim() || "Untitled");
    setEditingId(undefined);
  };

  const renderConversation = (c: ConversationSummary): JSX.Element => (
    <li
      key={c.id}
      className={
        c.id === props.activeId
          ? "conversation-item conversation-item--active"
          : "conversation-item"
      }
    >
      {editingId === c.id ? (
        <input
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEditing}
          onKeyDown={(e) => e.key === "Enter" && commitEditing()}
          aria-label="Rename conversation"
        />
      ) : (
        <button
          type="button"
          className="conversation-title"
          onClick={() => props.onSelect(c.id)}
          onDoubleClick={() => startEditing(c)}
        >
          {c.title}
        </button>
      )}
      <div className="conversation-item-actions">
        <button
          type="button"
          onClick={() => props.onArchive(c.id, true)}
          aria-label="Archive conversation"
        >
          Archive
        </button>
        <button type="button" onClick={() => props.onDelete(c.id)} aria-label="Delete conversation">
          Delete
        </button>
      </div>
    </li>
  );

  return (
    <nav className="sidebar glass">
      <span className="glass-highlight" />
      <button type="button" className="sidebar-new" onClick={props.onCreate}>
        + New conversation
      </button>
      <input
        className="sidebar-search"
        placeholder="Search conversations…"
        aria-label="Search conversations"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {pinned.length > 0 && (
        <>
          <div className="sidebar-section-label">Pinned</div>
          <ul className="conversation-list">{pinned.map(renderConversation)}</ul>
        </>
      )}
      <div className="sidebar-section-label">Recent</div>
      <ul className="conversation-list">{recent.map(renderConversation)}</ul>
      <div className="sidebar-spacer" />
      <ul className="sidebar-nav-list">
        <li>
          <button type="button" onClick={props.onOpenSettings}>
            Settings
          </button>
        </li>
      </ul>
    </nav>
  );
}

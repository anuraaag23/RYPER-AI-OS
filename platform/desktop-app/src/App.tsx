import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { SplashOverlay } from "./components/SplashOverlay.js";
import { ConfirmationDialog } from "./components/ConfirmationDialog.js";
import { useConversations } from "./hooks/useRyperData.js";
import { applyDesignTokens, resolveColorScheme } from "./lib/apply-tokens.js";

export function App(): JSX.Element {
  const { conversations, create, rename, archive, remove } = useConversations();
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [ready, setReady] = useState(false);

  console.log("[RYPER DEBUG] App render", { conversations, activeId });

  useEffect(() => {
    void window.ryper.getSettings().then((settings) => {
      applyDesignTokens(resolveColorScheme(settings.theme));
      setReady(true);
    });
    return window.ryper.onSettingsChanged((settings) => {
      applyDesignTokens(resolveColorScheme(settings.theme));
    });
  }, []);

  useEffect(() => {
    if (!activeId && conversations.length > 0) {
      const first = conversations[0];
      if (first) {
        console.log("[RYPER DEBUG] App selecting first conversation", first);
        setActiveId(first.id);
      }
    }
  }, [activeId, conversations]);

  console.log("[RYPER DEBUG] App activeId before render", activeId);

  const onCreate = (): void => {
    void create().then((conversation) => setActiveId(conversation.id));
  };

  return (
    <div className="app-shell">
      <SplashOverlay visible={!ready} />
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={onCreate}
        onRename={(id, title) => void rename(id, title)}
        onArchive={(id, archived) => {
          void archive(id, archived);
          if (id === activeId) setActiveId(undefined);
        }}
        onDelete={(id) => {
          void remove(id);
          if (id === activeId) setActiveId(undefined);
        }}
        onOpenSettings={() => void window.ryper.openSettingsWindow()}
      />
      <ChatPanel conversationId={activeId} />
      <ConfirmationDialog />
    </div>
  );
}



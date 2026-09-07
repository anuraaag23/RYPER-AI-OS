import { useEffect, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { SplashOverlay } from "./components/SplashOverlay.js";
import { ConfirmationDialog } from "./components/ConfirmationDialog.js";
import { OnboardingModal } from "./components/OnboardingModal.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { useConversations } from "./hooks/useRyperData.js";
import { applyDesignTokens, resolveColorScheme } from "./lib/apply-tokens.js";

const ONBOARDING_STORAGE_KEY = "ryper_onboarding_completed";

export function App(): JSX.Element {
  const { conversations, loaded, create, rename, archive, remove } = useConversations();
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const hasInitializedFirstRun = useRef(false);

  useEffect(() => {
    void window.ryper.getSettings().then((settings) => {
      applyDesignTokens(resolveColorScheme(settings.theme));
      setReady(true);
      const storageCompleted = localStorage.getItem(ONBOARDING_STORAGE_KEY) === "true";
      const settingsCompleted = settings.hasCompletedOnboarding ?? false;
      if (!storageCompleted && !settingsCompleted) {
        setShowOnboarding(true);
      }
    });
    return window.ryper.onSettingsChanged((settings) => {
      applyDesignTokens(resolveColorScheme(settings.theme));
    });
  }, []);

  const handleDismissOnboarding = (): void => {
    setShowOnboarding(false);
    try {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    } catch {}
    void window.ryper.updateSettings({ hasCompletedOnboarding: true });
  };

  // Clean first launch: auto-create initial conversation when 0 conversations exist (P0-2)
  useEffect(() => {
    if (!ready || !loaded || hasInitializedFirstRun.current) return;
    hasInitializedFirstRun.current = true;

    if (conversations.length === 0) {
      void create("New conversation").then((conversation) => {
        setActiveId(conversation.id);
      });
    } else if (!activeId) {
      const first = conversations[0];
      if (first) {
        setActiveId(first.id);
      }
    }
  }, [ready, loaded, conversations, activeId, create]);

  useEffect(() => {
    if (!activeId && conversations.length > 0) {
      const first = conversations[0];
      if (first) {
        setActiveId(first.id);
      }
    }
  }, [activeId, conversations]);

  const onCreate = (): void => {
    void create().then((conversation) => setActiveId(conversation.id));
  };

  const onStartConversation = (initialMessage?: string): void => {
    void create("New conversation").then(async (conversation) => {
      setActiveId(conversation.id);
      if (initialMessage && initialMessage.trim().length > 0) {
        await window.ryper.sendMessage({
          conversationId: conversation.id,
          content: initialMessage,
        });
      }
    });
  };

  return (
    <ErrorBoundary>
      <div className="app-shell">
        <SplashOverlay visible={!ready} />
        {showOnboarding && <OnboardingModal onComplete={handleDismissOnboarding} />}
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
        <ChatPanel conversationId={activeId} onStartConversation={onStartConversation} />
        <ConfirmationDialog />
      </div>
    </ErrorBoundary>
  );
}

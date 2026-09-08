import { useCallback, useEffect, useState } from "react";
import type {
  ConversationSummary,
  StoredMessage,
  VoiceOrbStatus,
  ConnectionStatus,
  CurrentReferencePayload,
  AIStatusPayload,
  AudioStatusPayload,
  TurnProgressPayload,
} from "../../electron/ipc-contract.js";
import { sanitizeUserFacingError } from "../lib/user-error-sanitizer.js";

export function useConversations(): {
  conversations: readonly ConversationSummary[];
  loaded: boolean;
  refresh: () => Promise<void>;
  create: (title?: string) => Promise<ConversationSummary>;
  rename: (id: string, title: string) => Promise<void>;
  archive: (id: string, archived: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
} {
  const [conversations, setConversations] = useState<readonly ConversationSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const list = await window.ryper.listConversations();
    setConversations(list);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A voice turn can create the "Voice" conversation on demand (see
  // `main.ts`'s `recordVoiceTurn`) without the renderer ever calling
  // `create()` — refresh the sidebar list so it actually shows up.
  useEffect(() => window.ryper.onConversationUpdated(() => void refresh()), [refresh]);

  const create = useCallback(
    async (title?: string) => {
      const conversation = await window.ryper.createConversation(title);
      await refresh();
      return conversation;
    },
    [refresh],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      await window.ryper.renameConversation(id, title);
      await refresh();
    },
    [refresh],
  );

  const archive = useCallback(
    async (id: string, archived: boolean) => {
      await window.ryper.archiveConversation(id, archived);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await window.ryper.deleteConversation(id);
      await refresh();
    },
    [refresh],
  );

  return { conversations, loaded, refresh, create, rename, archive, remove };
}

export function useMessages(conversationId: string | undefined): {
  messages: readonly StoredMessage[];
  refresh: () => Promise<void>;
  send: (content: string) => Promise<void>;
  remove: (messageId: string) => Promise<void>;
  regenerate: (messageId: string) => Promise<void>;
  sending: boolean;
  progress: TurnProgressPayload | undefined;
  /**
   * Real, visible failure state (Tier 1 UI brief section 12 — "no
   * silent success/failure"): sanitized for friendly presentation
   * without leaking raw technical traces.
   */
  error: string | undefined;
  canRetry: boolean;
  retry: () => void;
  clearError: () => void;
  cancel: () => void;
} {
  const [messages, setMessages] = useState<readonly StoredMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<TurnProgressPayload | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [canRetry, setCanRetry] = useState(false);
  const [lastFailedContent, setLastFailedContent] = useState<string | undefined>(undefined);
  const activeTurnId = useState(() => ({ current: undefined as string | undefined }))[0];

  const refresh = useCallback(async () => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    setMessages(await window.ryper.listMessages(conversationId));
  }, [conversationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Real voice-turn conversation-history integration (see `main.ts`'s
  // `recordVoiceTurn`): a spoken exchange is persisted on the main
  // side without the renderer ever calling `sendMessage()` itself, so
  // this window needs its own push-based refresh trigger rather than
  // relying on `send()`'s own post-await `refresh()`.
  useEffect(
    () =>
      window.ryper.onConversationUpdated((updatedId) => {
        if (updatedId === conversationId) void refresh();
      }),
    [conversationId, refresh],
  );

  useEffect(() => {
    if (typeof window?.ryper?.onTurnProgress === "function") {
      return window.ryper.onTurnProgress((p) => {
        if (p.conversationId === conversationId) {
          setProgress(p);
        }
      });
    }
  }, [conversationId]);

  const send = useCallback(
    async (content: string) => {
      if (!conversationId || content.trim().length === 0) return;
      setSending(true);
      setError(undefined);
      setCanRetry(false);
      const turnId = crypto.randomUUID();
      activeTurnId.current = turnId;
      setProgress({
        conversationId,
        turnId,
        stage: "thinking",
        label: "Thinking…",
      });
      try {
        await window.ryper.sendMessage({ conversationId, content, turnId });
        setLastFailedContent(undefined);
        await refresh();
      } catch (err) {
        const sanitized = sanitizeUserFacingError(err);
        setError(sanitized.message);
        setCanRetry(sanitized.canRetry);
        if (sanitized.canRetry) {
          setLastFailedContent(content);
        } else {
          setLastFailedContent(undefined);
        }
        await refresh();
      } finally {
        activeTurnId.current = undefined;
        setSending(false);
        setProgress(undefined);
      }
    },
    [conversationId, refresh, activeTurnId],
  );

  const retry = useCallback((): void => {
    if (lastFailedContent && canRetry) {
      void send(lastFailedContent);
    }
  }, [lastFailedContent, canRetry, send]);

  const remove = useCallback(
    async (messageId: string) => {
      if (!conversationId) return;
      await window.ryper.deleteMessage(conversationId, messageId);
      await refresh();
    },
    [conversationId, refresh],
  );

  const regenerate = useCallback(
    async (messageId: string) => {
      if (!conversationId) return;
      setSending(true);
      setError(undefined);
      setCanRetry(false);
      setProgress({
        conversationId,
        stage: "thinking",
        label: "Thinking…",
      });
      try {
        await window.ryper.regenerateMessage(conversationId, messageId);
        await refresh();
      } catch (err) {
        const sanitized = sanitizeUserFacingError(err);
        setError(sanitized.message);
        setCanRetry(sanitized.canRetry);
        await refresh();
      } finally {
        setSending(false);
        setProgress(undefined);
      }
    },
    [conversationId, refresh],
  );

  const cancel = useCallback((): void => {
    if (activeTurnId.current) void window.ryper.cancelTurn(activeTurnId.current);
  }, [activeTurnId]);

  return {
    messages,
    refresh,
    send,
    remove,
    regenerate,
    sending,
    progress,
    error,
    canRetry,
    retry,
    clearError: () => {
      setError(undefined);
      setCanRetry(false);
      setLastFailedContent(undefined);
    },
    cancel,
  };
}

export function useAIStatus(): AIStatusPayload {
  const [status, setStatus] = useState<AIStatusPayload>({
    mode: "local",
    label: "Local AI • Qwen3-8B",
    ready: true,
  });

  useEffect(() => {
    let cancelled = false;
    if (typeof window?.ryper?.getAIStatus === "function") {
      void window.ryper
        .getAIStatus()
        .then((s) => {
          if (!cancelled && s) setStatus(s);
        })
        .catch(() => {
          // Fallback gracefully to default
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}

export function useVoiceState(): { status: VoiceOrbStatus; connection: ConnectionStatus } {
  const [status, setStatus] = useState<VoiceOrbStatus>("idle");
  const [connection, setConnection] = useState<ConnectionStatus>("connected");

  useEffect(
    () =>
      window.ryper.onVoiceState((state) => {
        setStatus(state.orbStatus);
        setConnection(state.connection);
      }),
    [],
  );

  return { status, connection };
}

export function useAudioStatus(): AudioStatusPayload | undefined {
  const [status, setStatus] = useState<AudioStatusPayload | undefined>(undefined);

  useEffect(() => {
    let active = true;
    if (typeof window?.ryper?.getAudioStatus === "function") {
      void window.ryper
        .getAudioStatus()
        .then((s) => {
          if (active && s) setStatus(s);
        })
        .catch(() => {
          // ignore error
        });
    }
    const unsub = window?.ryper?.onAudioStatusChanged?.((s) => {
      if (active && s) setStatus(s);
    });
    return () => {
      active = false;
      unsub?.();
    };
  }, []);

  return status;
}

/**
 * Surfaces the one real thing "open this"/"play this" would currently
 * resolve to (Tier 1 UI brief section E/10 — "contextual references
 * ... actually usable from the production UI"). Previously this state
 * existed only inside `ContextReferenceTracker` on the main side, with
 * no way for the user to know what "this" meant before saying it.
 *
 * There's no push event for this (it changes deep inside a tool call,
 * not at a point that already broadcasts something) — refreshed after
 * every message exchange, and on a slow poll as a fallback so a
 * reference set purely via voice (with this window just sitting open)
 * still eventually shows up.
 */
export function useCurrentReference(refreshKey: unknown): CurrentReferencePayload | undefined {
  const [reference, setReference] = useState<CurrentReferencePayload | undefined>(undefined);

  const refresh = useCallback(() => {
    void window.ryper.getCurrentReference().then(setReference);
  }, []);

  useEffect(refresh, [refresh, refreshKey]);

  useEffect(() => {
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => window.ryper.onConversationUpdated(refresh), [refresh]);

  return reference;
}

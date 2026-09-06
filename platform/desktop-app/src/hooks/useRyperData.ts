import { useCallback, useEffect, useState } from "react";
import type {
  ConversationSummary,
  StoredMessage,
  VoiceOrbStatus,
  ConnectionStatus,
  CurrentReferencePayload,
} from "../../electron/ipc-contract.js";

export function useConversations(): {
  conversations: readonly ConversationSummary[];
  refresh: () => Promise<void>;
  create: (title?: string) => Promise<ConversationSummary>;
  rename: (id: string, title: string) => Promise<void>;
  archive: (id: string, archived: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
} {
  const [conversations, setConversations] = useState<readonly ConversationSummary[]>([]);

  const refresh = useCallback(async () => {
    const list = await window.ryper.listConversations();
    setConversations(list);
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

  return { conversations, refresh, create, rename, archive, remove };
}

export function useMessages(conversationId: string | undefined): {
  messages: readonly StoredMessage[];
  refresh: () => Promise<void>;
  send: (content: string) => Promise<void>;
  remove: (messageId: string) => Promise<void>;
  regenerate: (messageId: string) => Promise<void>;
  sending: boolean;
  /**
   * Real, visible failure state (Tier 1 UI brief section 12 — "no
   * silent success/failure"): previously a rejected `sendMessage()`
   * call left `sending` reset with nothing else shown, so a genuine AI
   * or tool failure was invisible in the UI. `null` when the last turn
   * succeeded or none has run yet.
   */
  error: string | undefined;
  clearError: () => void;
  cancel: () => void;
} {
  const [messages, setMessages] = useState<readonly StoredMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
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

  const send = useCallback(
    async (content: string) => {
      if (!conversationId || content.trim().length === 0) return;
      setSending(true);
      setError(undefined);
      const turnId = crypto.randomUUID();
      activeTurnId.current = turnId;
      try {
        await window.ryper.sendMessage({ conversationId, content, turnId });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await refresh();
      } finally {
        activeTurnId.current = undefined;
        setSending(false);
      }
    },
    [conversationId, refresh, activeTurnId],
  );

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
      try {
        await window.ryper.regenerateMessage(conversationId, messageId);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await refresh();
      } finally {
        setSending(false);
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
    error,
    clearError: () => setError(undefined),
    cancel,
  };
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

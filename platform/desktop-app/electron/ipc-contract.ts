/**
 * The single source of truth for every IPC channel between the Electron
 * main process and the renderer(s). Both `preload.ts` (which builds the
 * `contextBridge` API) and the renderer (via `window.ryper`) import these
 * types, so a channel added here is type-checked on both sides — there is
 * no separate, hand-duplicated channel list to drift out of sync.
 */

import type { AssistantReply } from "@ryper/conversation";
import type { MemoryCategory } from "@ryper/memory";

export interface ConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archived: boolean;
  readonly pinned: boolean;
}

export type MessageRole = "user" | "assistant";

/**
 * A single real tool invocation surfaced to the UI, built from the
 * orchestrator's own `tool_call`/`tool_result` `StreamEvent`s (see
 * `text-chat.ts`) — never fabricated, and never carrying raw argument
 * values that might contain secrets/credentials/paths a user hasn't
 * seen echoed back yet: `argsSummary`/`resultSummary` are pre-redacted,
 * truncated, JSON-safe strings built server-side. `ok` is the tool's
 * own authoritative result, not inferred from the model's narration.
 */
export interface ToolActivityEntry {
  readonly toolCallId: string;
  readonly name: string;
  readonly argsSummary: string;
  readonly ok: boolean;
  readonly resultSummary: string;
}

export interface StoredMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly createdAt: string;
  readonly routingTarget?: "local" | "cloud";
  readonly toolActivity?: readonly ToolActivityEntry[];
  /** True when this assistant turn ended via user cancellation, not a model reply. */
  readonly cancelled?: boolean;
}

export interface SendMessageRequest {
  readonly conversationId: string;
  readonly content: string;
  /**
   * Client-generated id echoed back so `cancelTurn(turnId)` can target
   * this specific in-flight turn — a single request/response `invoke()`
   * call has no channel of its own to cancel otherwise.
   */
  readonly turnId?: string;
}

export interface SendMessageResponse extends AssistantReply {
  readonly message: StoredMessage;
  readonly toolActivity?: readonly ToolActivityEntry[];
  readonly cancelled?: boolean;
}

export type VoiceOrbStatus = "idle" | "listening" | "thinking" | "speaking";
export type ConnectionStatus = "connected" | "degraded" | "offline";

export interface VoiceStatePayload {
  readonly orbStatus: VoiceOrbStatus;
  readonly connection: ConnectionStatus;
}

export type ThemePreference = "light" | "dark" | "system";
export type VoiceLanguagePreference = "auto" | "en" | "hi";
export type TtsVoicePreference = "auto" | "en" | "en-IN" | "hi";
export type PermissionPolicy = "always" | "prompt" | "denied";

export interface AppSettings {
  readonly theme: ThemePreference;
  readonly voiceEnabled: boolean;
  readonly launchAtLogin: boolean;
  readonly pushToTalkShortcut: string;
  /**
   * The user's preferred spoken language for speech recognition:
   * "auto" (multilingual / auto-detect), "en" (English), "hi" (Hindi).
   */
  readonly voiceLanguage?: VoiceLanguagePreference | undefined;
  /**
   * The user's preferred voice model/accent for text-to-speech output:
   * "auto" (match response language), "en" (English), "en-IN" (Indian English), "hi" (Hindi).
   */
  readonly ttsVoice?: TtsVoicePreference | undefined;
  /**
   * The browser `open_url`/`open_application` should use when the
   * request doesn't name one explicitly (e.g. "open YouTube" vs "open
   * YouTube in Chrome") — one of `resolveBrowserId`'s real, recognized
   * ids (`@ryper/windows-agent`), or `undefined` to use the system
   * default. This is a real, explicit user choice, not a silent
   * substitution: it only ever takes effect when nothing was named in
   * the request itself, and an unresolvable/stale value degrades to
   * the system default rather than failing the open.
   */
  readonly preferredBrowserId?: string;
  /** True if the user has completed or dismissed the initial first-run onboarding. */
  readonly hasCompletedOnboarding?: boolean;
  /** Persistent capability authorization policies across sessions. */
  readonly persistentPermissions?: Readonly<Record<string, PermissionPolicy>> | undefined;
}

export interface HealthCheckSummary {
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly platform: string;
  readonly platformVersion: string;
  readonly capabilitiesSupported: number;
  readonly capabilitiesTotal: number;
  readonly details: readonly string[];
}

export interface StartupDiagnostics {
  readonly step: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface MemorySummary {
  readonly id: string;
  readonly category: MemoryCategory;
  readonly content: string;
  readonly importance: number;
  readonly createdAt: string;
}

/**
 * Real, UI-backed confirmation dialog (docs/adr/0032) — closes the
 * most-repeated honest limitation across the last several ADRs:
 * `CapabilityBroker`'s `consentPrompt` and `@ryper/windows-agent`'s
 * `DestructiveActionGate` confirmer both previously had no real UI to
 * ask through at all (`main.ts` passed a literal `async () => false`,
 * and `createWindowsAdapter()` was never given a confirmer, defaulting
 * to deny-everything). One real main<->renderer round trip now backs
 * both.
 */
export interface ConfirmationRequestPayload {
  readonly id: string;
  readonly title: string;
  readonly message: string;
  readonly approveLabel?: string;
  readonly denyLabel?: string;
  readonly capability?: string;
}

export interface PermissionEntryPayload {
  readonly id: string;
  readonly category: string;
  readonly description: string;
  readonly granted: boolean;
  readonly isSessionOnly: boolean;
  readonly policy?: PermissionPolicy;
}

// ---- Phase 13.6: real audio devices ----

export type AudioDeviceKindPayload = "microphone" | "speaker";

export interface AudioDevicePayload {
  readonly id: string;
  readonly name: string;
  readonly kind: AudioDeviceKindPayload;
  readonly transport: "builtin" | "usb" | "bluetooth" | "virtual";
  readonly isDefault: boolean;
}

export type AudioAvailability = "available" | "permission-denied" | "unavailable";

export interface AudioStatusPayload {
  readonly microphone: AudioAvailability;
  readonly speaker: AudioAvailability;
  readonly selectedMicrophoneName?: string;
  readonly selectedSpeakerName?: string;
  /**
   * Set when the most recent playback could not actually be routed to
   * the selected speaker (e.g. `HTMLMediaElement.setSinkId()`
   * unsupported/rejected on this system) and fell back to the system
   * default output instead. `undefined` when routing succeeded, no
   * speech has played yet, or the default device is selected (nothing
   * to route away from). See `platform/desktop-app/src/audio/
   * playback-client.ts` and the Tier 1 UI brief's explicit instruction
   * not to imply output-device routing works when it doesn't.
   */
  readonly outputRoutingWarning?: string;
}

/** Renderer -> main (invoke/response). */
export interface RyperInvokeApi {
  listConversations(): Promise<readonly ConversationSummary[]>;
  createConversation(title?: string): Promise<ConversationSummary>;
  renameConversation(id: string, title: string): Promise<void>;
  archiveConversation(id: string, archived: boolean): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  listMessages(conversationId: string): Promise<readonly StoredMessage[]>;
  sendMessage(request: SendMessageRequest): Promise<SendMessageResponse>;
  deleteMessage(conversationId: string, messageId: string): Promise<void>;
  regenerateMessage(conversationId: string, messageId: string): Promise<SendMessageResponse>;
  searchMemory(query: string): Promise<readonly MemorySummary[]>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  getHealth(): Promise<HealthCheckSummary>;
  openSettingsWindow(): Promise<void>;
  startVoiceTurn(): Promise<void>;
  stopVoiceTurn(): Promise<void>;
  listAudioDevices(kind?: AudioDeviceKindPayload): Promise<readonly AudioDevicePayload[]>;
  selectAudioDevice(kind: AudioDeviceKindPayload, deviceId: string): Promise<void>;
  getAudioStatus(): Promise<AudioStatusPayload>;
  requestAudioPermission(kind: AudioDeviceKindPayload): Promise<boolean>;
  respondToConfirmation(id: string, approved: boolean): Promise<void>;
  /**
   * Aborts the in-flight `sendMessage`/`regenerateMessage` turn tagged
   * with this `turnId`, if one is still running. Resolves regardless of
   * whether a matching turn was found (there's an inherent race between
   * a turn finishing on its own and a cancel request arriving) — the
   * caller's own `sendMessage()` promise settling is the source of
   * truth for whether cancellation actually happened in time.
   */
  cancelTurn(turnId: string): Promise<void>;
  /**
   * The one real thing "open this"/"play this" would currently resolve
   * to (see `context-reference.ts`'s `ContextReferenceTracker`) — or
   * `undefined` if there's nothing set, or it's gone stale. Read-only:
   * the renderer can display it, but only a real successful
   * open_file/open_url/open_folder/etc. tool call (via voice or text)
   * ever sets it — never something typed into the composer.
   */
  getCurrentReference(): Promise<CurrentReferencePayload | undefined>;
  listPermissions(): Promise<readonly PermissionEntryPayload[]>;
  resetPermissions(): Promise<void>;
  setPermissionPolicy(capability: string, policy: PermissionPolicy): Promise<void>;
  getAIStatus(): Promise<AIStatusPayload>;
  restartLocalAI(): Promise<{ readonly ok: boolean; readonly message: string }>;
  openLogsFolder(): Promise<void>;
}

export type LocalAIReadinessState = "ready" | "starting" | "missing" | "failed";

export interface AIStatusPayload {
  readonly mode: "local" | "cloud" | "heuristic";
  readonly label: string;
  readonly ready: boolean;
  readonly readinessState?: LocalAIReadinessState;
  readonly detail?: string;
}

export type TurnProgressStage = "thinking" | "warmup" | "tool" | "generating";

export interface TurnProgressPayload {
  readonly conversationId: string;
  readonly turnId?: string | undefined;
  readonly stage: TurnProgressStage;
  readonly label: string;
}

/** Renderer-facing mirror of `context-reference.ts`'s `CurrentReference` — a plain, serializable shape for IPC. */
export interface CurrentReferencePayload {
  readonly type: "file" | "folder" | "url" | "application" | "media";
  readonly path?: string;
  readonly url?: string;
  readonly name?: string;
  readonly source?: string;
}

/** Main -> renderer (event push). */
export interface RyperEventApi {
  onVoiceState(handler: (state: VoiceStatePayload) => void): () => void;
  onStartupDiagnostics(handler: (event: StartupDiagnostics) => void): () => void;
  onSettingsChanged(handler: (settings: AppSettings) => void): () => void;
  onAudioStatusChanged(handler: (status: AudioStatusPayload) => void): () => void;
  onConfirmationRequested(handler: (request: ConfirmationRequestPayload) => void): () => void;
  /**
   * Fires whenever main-process code appends a message to a
   * conversation the renderer didn't itself request — currently just
   * real voice turns (see `main.ts`'s `startVoiceTurn`). The renderer
   * re-fetches that conversation's messages if it's the one currently
   * open, so a spoken exchange shows up in the chat window without
   * polling.
   */
  onConversationUpdated(handler: (conversationId: string) => void): () => void;
  onTurnProgress(handler: (progress: TurnProgressPayload) => void): () => void;
}

export const IPC_CHANNELS = {
  listConversations: "conversations:list",
  createConversation: "conversations:create",
  renameConversation: "conversations:rename",
  archiveConversation: "conversations:archive",
  deleteConversation: "conversations:delete",
  listMessages: "messages:list",
  sendMessage: "messages:send",
  deleteMessage: "messages:delete",
  regenerateMessage: "messages:regenerate",
  searchMemory: "memory:search",
  getSettings: "settings:get",
  updateSettings: "settings:update",
  getHealth: "diagnostics:health",
  openSettingsWindow: "window:open-settings",
  startVoiceTurn: "voice:start",
  stopVoiceTurn: "voice:stop",
  voiceState: "voice:state",
  startupDiagnostics: "startup:diagnostics",
  settingsChanged: "settings:changed",
  listAudioDevices: "audio:list-devices",
  selectAudioDevice: "audio:select-device",
  getAudioStatus: "audio:get-status",
  requestAudioPermission: "audio:request-permission",
  audioStatusChanged: "audio:status-changed",
  confirmationRequested: "confirmation:requested",
  respondToConfirmation: "confirmation:respond",
  cancelTurn: "messages:cancel",
  conversationUpdated: "conversations:updated",
  getCurrentReference: "context:current-reference",
  listPermissions: "permissions:list",
  resetPermissions: "permissions:reset",
  setPermissionPolicy: "permissions:set-policy",
  getAIStatus: "ai:status",
  turnProgress: "turn:progress",
  restartLocalAI: "ai:restart",
  openLogsFolder: "diagnostics:open-logs",
} as const;

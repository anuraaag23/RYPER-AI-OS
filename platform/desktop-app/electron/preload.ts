import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type AppSettings,
  type AudioDeviceKindPayload,
  type AudioStatusPayload,
  type ConfirmationRequestPayload,
  type CurrentReferencePayload,
  type RyperEventApi,
  type RyperInvokeApi,
  type SendMessageRequest,
  type StartupDiagnostics,
  type TurnProgressPayload,
  type VoiceStatePayload,
} from "./ipc-contract.js";
import { AUDIO_IPC_CHANNELS } from "./audio-ipc-contract.js";

function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const invokeApi: RyperInvokeApi = {
  listConversations: () => ipcRenderer.invoke(IPC_CHANNELS.listConversations),
  createConversation: (title) => ipcRenderer.invoke(IPC_CHANNELS.createConversation, title),
  renameConversation: (id, title) => ipcRenderer.invoke(IPC_CHANNELS.renameConversation, id, title),
  archiveConversation: (id, archived) =>
    ipcRenderer.invoke(IPC_CHANNELS.archiveConversation, id, archived),
  deleteConversation: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteConversation, id),
  listMessages: (conversationId) => ipcRenderer.invoke(IPC_CHANNELS.listMessages, conversationId),
  sendMessage: (request: SendMessageRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.sendMessage, request),
  deleteMessage: (conversationId, messageId) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteMessage, conversationId, messageId),
  regenerateMessage: (conversationId, messageId) =>
    ipcRenderer.invoke(IPC_CHANNELS.regenerateMessage, conversationId, messageId),
  searchMemory: (query) => ipcRenderer.invoke(IPC_CHANNELS.searchMemory, query),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
  updateSettings: (patch: Partial<AppSettings>) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateSettings, patch),
  getHealth: () => ipcRenderer.invoke(IPC_CHANNELS.getHealth),
  openSettingsWindow: () => ipcRenderer.invoke(IPC_CHANNELS.openSettingsWindow),
  startVoiceTurn: () => ipcRenderer.invoke(IPC_CHANNELS.startVoiceTurn),
  stopVoiceTurn: () => ipcRenderer.invoke(IPC_CHANNELS.stopVoiceTurn),
  listAudioDevices: (kind?: AudioDeviceKindPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.listAudioDevices, kind),
  selectAudioDevice: (kind: AudioDeviceKindPayload, deviceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.selectAudioDevice, kind, deviceId),
  getAudioStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getAudioStatus),
  requestAudioPermission: (kind: AudioDeviceKindPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.requestAudioPermission, kind),
  respondToConfirmation: (id: string, approved: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.respondToConfirmation, id, approved),
  cancelTurn: (turnId: string) => ipcRenderer.invoke(IPC_CHANNELS.cancelTurn, turnId),
  getCurrentReference(): Promise<CurrentReferencePayload | undefined> {
    return ipcRenderer.invoke(IPC_CHANNELS.getCurrentReference);
  },
  listPermissions: () => ipcRenderer.invoke(IPC_CHANNELS.listPermissions),
  resetPermissions: () => ipcRenderer.invoke(IPC_CHANNELS.resetPermissions),
  setPermissionPolicy: (capability, policy) =>
    ipcRenderer.invoke(IPC_CHANNELS.setPermissionPolicy, capability, policy),
  getAIStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getAIStatus),
  restartLocalAI: () => ipcRenderer.invoke(IPC_CHANNELS.restartLocalAI),
  openLogsFolder: () => ipcRenderer.invoke(IPC_CHANNELS.openLogsFolder),
};

const eventApi: RyperEventApi = {
  onVoiceState: (handler: (state: VoiceStatePayload) => void) =>
    subscribe(IPC_CHANNELS.voiceState, handler),
  onStartupDiagnostics: (handler: (event: StartupDiagnostics) => void) =>
    subscribe(IPC_CHANNELS.startupDiagnostics, handler),
  onSettingsChanged: (handler: (settings: AppSettings) => void) =>
    subscribe(IPC_CHANNELS.settingsChanged, handler),
  onAudioStatusChanged: (handler: (status: AudioStatusPayload) => void) =>
    subscribe(IPC_CHANNELS.audioStatusChanged, handler),
  onConfirmationRequested: (handler: (request: ConfirmationRequestPayload) => void) =>
    subscribe(IPC_CHANNELS.confirmationRequested, handler),
  onConversationUpdated: (handler: (conversationId: string) => void) =>
    subscribe(IPC_CHANNELS.conversationUpdated, handler),
  onTurnProgress: (handler: (progress: TurnProgressPayload) => void) =>
    subscribe(IPC_CHANNELS.turnProgress, handler),
};

contextBridge.exposeInMainWorld("ryper", { ...invokeApi, ...eventApi });

/**
 * Low-level pass-through for `audio-ipc-contract.ts`'s main<->renderer
 * audio-bridge protocol (`RendererAudioBridge` in `electron/audio-
 * bridge.ts` on the main side, `src/audio/*` on this side). Deliberately
 * generic (`onCommand`/`sendResult`) rather than one bespoke method per
 * channel: the channel set is closed and fully typed by
 * `audio-ipc-contract.ts` on both ends, so a thin, uniform pass-through
 * here adds no untyped surface while keeping this file from growing a
 * new method every time a channel is added. No Node/Electron API is
 * exposed beyond these two narrow, audio-channel-only functions — the
 * renderer still cannot reach `ipcRenderer` directly (sandbox intact).
 */
const audioBridgeApi = {
  onCommand: (handler: (channel: string, payload: unknown) => void): (() => void) => {
    const listeners = Object.values(AUDIO_IPC_CHANNELS.toRenderer).map((channel) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void =>
        handler(channel, payload);
      ipcRenderer.on(channel, listener);
      return { channel, listener };
    });
    return () => {
      for (const { channel, listener } of listeners) ipcRenderer.removeListener(channel, listener);
    };
  },
  sendResult: (channel: string, payload: unknown): void => {
    const known = new Set<string>(Object.values(AUDIO_IPC_CHANNELS.fromRenderer));
    if (!known.has(channel))
      throw new Error(`"${channel}" is not a recognized audio-bridge reply channel`);
    ipcRenderer.send(channel, payload);
  },
};

contextBridge.exposeInMainWorld("ryperAudioBridge", audioBridgeApi);

export type RyperBridge = RyperInvokeApi & RyperEventApi;
export type RyperAudioBridgeApi = typeof audioBridgeApi;

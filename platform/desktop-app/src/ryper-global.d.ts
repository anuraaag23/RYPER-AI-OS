import type { RyperEventApi, RyperInvokeApi } from "../electron/ipc-contract.js";
import type { RyperAudioBridgeApi } from "../electron/preload.js";

declare global {
  interface Window {
    readonly ryper: RyperInvokeApi & RyperEventApi;
    readonly ryperAudioBridge: RyperAudioBridgeApi;
  }
}

export {};

import { AUDIO_IPC_CHANNELS } from "../../electron/audio-ipc-contract.js";
import type {
  HasPermissionCommand,
  ListDevicesCommand,
  PlayChunkCommand,
  PlayCommand,
  PlayEndCommand,
  RequestPermissionCommand,
  SetVolumeCommand,
  StartCaptureCommand,
  StopCaptureCommand,
  StopPlaybackCommand,
} from "../../electron/audio-ipc-contract.js";
import { startMicrophoneCapture, type CaptureHandle } from "./capture-client.js";
import {
  createPlaybackSession,
  setPlaybackVolume,
  type PlaybackSession,
} from "./playback-client.js";
import {
  hasAudioPermission,
  listAudioDevicesReal,
  requestAudioPermissionReal,
} from "./device-client.js";

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The real Phase 13.6 renderer half of the audio bridge. Mounted once
 * from `main.tsx` regardless of which view is showing (voice I/O isn't
 * tied to any particular screen). Every command received here maps to a
 * real browser API call in `capture-client.ts`/`playback-client.ts`/
 * `device-client.ts` — this file only does dispatch and requestId
 * bookkeeping.
 */
export function installRendererAudioBridge(): () => void {
  const activeCaptures = new Map<string, CaptureHandle>();
  const activePlaybacks = new Map<string, PlaybackSession>();

  async function handleCommand(channel: string, payload: unknown): Promise<void> {
    const c = AUDIO_IPC_CHANNELS;
    switch (channel) {
      case c.toRenderer.listDevices: {
        const { requestId } = payload as ListDevicesCommand;
        try {
          const devices = await listAudioDevicesReal();
          window.ryperAudioBridge.sendResult(c.fromRenderer.listDevicesResult, {
            requestId,
            devices,
          });
        } catch (err) {
          window.ryperAudioBridge.sendResult(c.fromRenderer.listDevicesResult, {
            requestId,
            error: describeError(err),
          });
        }
        return;
      }
      case c.toRenderer.hasPermission: {
        const { requestId, kind } = payload as HasPermissionCommand;
        const granted = await hasAudioPermission(kind);
        window.ryperAudioBridge.sendResult(c.fromRenderer.hasPermissionResult, {
          requestId,
          granted,
        });
        return;
      }
      case c.toRenderer.requestPermission: {
        const { requestId, kind } = payload as RequestPermissionCommand;
        const granted = await requestAudioPermissionReal(kind);
        window.ryperAudioBridge.sendResult(c.fromRenderer.requestPermissionResult, {
          requestId,
          granted,
        });
        return;
      }
      case c.toRenderer.startCapture: {
        const { requestId, deviceId, sampleRateHz } = payload as StartCaptureCommand;
        const handle = await startMicrophoneCapture(deviceId, sampleRateHz, {
          onFrame: (frame) =>
            window.ryperAudioBridge.sendResult(c.fromRenderer.captureFrame, {
              requestId,
              samples: frame.samples,
              sampleRateHz: frame.sampleRateHz,
            }),
          onError: (message) => {
            activeCaptures.delete(requestId);
            window.ryperAudioBridge.sendResult(c.fromRenderer.captureError, { requestId, message });
          },
          onEnded: () => {
            activeCaptures.delete(requestId);
            window.ryperAudioBridge.sendResult(c.fromRenderer.captureError, {
              requestId,
              message: "microphone device disconnected",
            });
          },
        });
        activeCaptures.set(requestId, handle);
        return;
      }
      case c.toRenderer.stopCapture: {
        const { requestId } = payload as StopCaptureCommand;
        activeCaptures.get(requestId)?.stop();
        activeCaptures.delete(requestId);
        window.ryperAudioBridge.sendResult(c.fromRenderer.captureStopped, { requestId });
        return;
      }
      case c.toRenderer.play: {
        const { requestId, deviceId } = payload as PlayCommand;
        let sinkRoutingFailed: string | undefined;
        const session = createPlaybackSession(
          (ok, error) => {
            activePlaybacks.delete(requestId);
            window.ryperAudioBridge.sendResult(c.fromRenderer.playResult, {
              requestId,
              ok,
              error,
              ...(sinkRoutingFailed ? { sinkRoutingFailed } : {}),
            });
          },
          deviceId,
          (reason) => {
            sinkRoutingFailed = reason;
          },
        );
        activePlaybacks.set(requestId, session);
        return;
      }
      case c.toRenderer.playChunk: {
        const { requestId, bytes, mimeType } = payload as PlayChunkCommand;
        activePlaybacks.get(requestId)?.pushChunk(bytes, mimeType);
        return;
      }
      case c.toRenderer.playEnd: {
        const { requestId } = payload as PlayEndCommand;
        activePlaybacks.get(requestId)?.end();
        return;
      }
      case c.toRenderer.stopPlayback: {
        const { requestId } = payload as StopPlaybackCommand;
        activePlaybacks.get(requestId)?.stop();
        activePlaybacks.delete(requestId);
        return;
      }
      case c.toRenderer.setVolume: {
        const { requestId, volume } = payload as SetVolumeCommand;
        setPlaybackVolume(volume);
        window.ryperAudioBridge.sendResult(c.fromRenderer.setVolumeResult, { requestId, ok: true });
        return;
      }
      default:
        return;
    }
  }

  const unsubscribeCommands = window.ryperAudioBridge.onCommand((channel, payload) => {
    void handleCommand(channel, payload);
  });

  const onDeviceChange = (): void => {
    window.ryperAudioBridge.sendResult(AUDIO_IPC_CHANNELS.fromRenderer.deviceChange, {
      reason: "devicechange",
    });
  };
  navigator.mediaDevices.addEventListener?.("devicechange", onDeviceChange);

  return () => {
    unsubscribeCommands();
    navigator.mediaDevices.removeEventListener?.("devicechange", onDeviceChange);
    for (const handle of activeCaptures.values()) handle.stop();
    activeCaptures.clear();
    for (const session of activePlaybacks.values()) session.stop();
    activePlaybacks.clear();
  };
}

import { createLogger } from "@ryper/logging";
import type { WindowsSystemApi } from "./windows-system-api.js";
import type { AudioDeviceInfo, MediaControlAction, MediaSessionState } from "./types.js";

const log = createLogger("windows-agent:audio-manager");

/** The brief's AUDIO section: volume, mute, default device, enumeration, and media playback controls. */
export class AudioManager {
  constructor(private readonly systemApi: WindowsSystemApi) {}

  getVolume(): Promise<number> {
    return this.systemApi.getVolume();
  }

  async setVolume(level: number): Promise<void> {
    if (level < 0 || level > 100) throw new Error("volume must be within 0-100");
    await this.systemApi.setVolume(level);
    log.info("volume set", { level });
  }

  getMute(): Promise<boolean> {
    return this.systemApi.getMute();
  }

  async setMute(muted: boolean): Promise<void> {
    await this.systemApi.setMute(muted);
  }

  async toggleMute(): Promise<boolean> {
    const muted = await this.getMute();
    await this.setMute(!muted);
    return !muted;
  }

  listDevices(): Promise<readonly AudioDeviceInfo[]> {
    return this.systemApi.listAudioDevices();
  }

  async setDefaultDevice(id: string): Promise<void> {
    await this.systemApi.setDefaultAudioDevice(id);
    log.info("default audio device changed", { id });
  }

  mediaControl(action: MediaControlAction): Promise<void> {
    return this.systemApi.mediaControl(action);
  }

  getNowPlayingState(): Promise<MediaSessionState> {
    return this.systemApi.getNowPlayingState();
  }
}

export function createAudioManager(systemApi: WindowsSystemApi): AudioManager {
  return new AudioManager(systemApi);
}

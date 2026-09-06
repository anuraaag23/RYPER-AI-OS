import type { WindowsSystemApi } from "./windows-system-api.js";
import type { DisplayInfo } from "./types.js";

/** The brief's DISPLAY entries under System Information: enumerate displays and read configuration. */
export class DisplayManager {
  constructor(private readonly systemApi: WindowsSystemApi) {}

  list(): Promise<readonly DisplayInfo[]> {
    return this.systemApi.listDisplays();
  }

  async getPrimary(): Promise<DisplayInfo | undefined> {
    const displays = await this.systemApi.listDisplays();
    return displays.find((d) => d.primary) ?? displays[0];
  }
}

export function createDisplayManager(systemApi: WindowsSystemApi): DisplayManager {
  return new DisplayManager(systemApi);
}

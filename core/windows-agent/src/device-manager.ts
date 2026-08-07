import type { WindowsSystemApi } from "./windows-system-api.js";
import type { DeviceSummary, SystemInfoSnapshot } from "./types.js";

/**
 * The brief's DEVICE MANAGEMENT + SYSTEM INFORMATION sections: enumerate
 * hardware devices and expose CPU/GPU/RAM/storage/battery/OS
 * version/display/network in one snapshot.
 */
export class DeviceManager {
  constructor(private readonly systemApi: WindowsSystemApi) {}

  listDevices(): Promise<readonly DeviceSummary[]> {
    return this.systemApi.listDevices();
  }

  getSystemInfo(): Promise<SystemInfoSnapshot> {
    return this.systemApi.getSystemInfo();
  }
}

export function createDeviceManager(systemApi: WindowsSystemApi): DeviceManager {
  return new DeviceManager(systemApi);
}

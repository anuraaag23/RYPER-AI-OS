import type { WindowsSystemApi } from "./windows-system-api.js";
import type { DeviceSummary, NetworkAdapterInfo, SystemInfoSnapshot } from "./types.js";

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

  listNetworkAdapters(): Promise<readonly NetworkAdapterInfo[]> {
    return this.systemApi.listNetworkAdapters();
  }
}

export function createDeviceManager(systemApi: WindowsSystemApi): DeviceManager {
  return new DeviceManager(systemApi);
}

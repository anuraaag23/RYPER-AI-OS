import type { DeviceCapabilities } from "./types.js";

export interface OsLike {
  readonly cpus: () => readonly unknown[];
  readonly totalmem: () => number;
  readonly freemem: () => number;
  readonly platform: () => string;
  readonly arch: () => string;
}

export interface GpuDetector {
  detect(): Promise<{ hasGpu: boolean; vramGB?: number }>;
}

export interface BatteryDetector {
  detect(): Promise<{ batteryPercent?: number; isCharging?: boolean }>;
}

/** No GPU/battery signal available — the honest default until a platform shell injects a real detector. */
export const noGpuDetector: GpuDetector = {
  detect: async () => ({ hasGpu: false }),
};
export const noBatteryDetector: BatteryDetector = {
  detect: async () => ({}),
};

function mapPlatform(nodePlatform: string): DeviceCapabilities["platform"] {
  switch (nodePlatform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    case "android":
      return "android";
    case "ios":
      return "ios";
    default:
      return "unknown";
  }
}

/**
 * CPU core count and RAM come from a real, injected `os`-shaped source
 * (Node's `os` module satisfies this directly — see `createNodeCapabilityDetector`
 * in the package README for the one-line wiring). GPU and battery have no
 * portable Node API, so they're separately injectable and default to "none
 * detected" rather than a guess.
 */
export class DeviceCapabilityDetector {
  constructor(
    private readonly os: OsLike,
    private readonly gpu: GpuDetector = noGpuDetector,
    private readonly battery: BatteryDetector = noBatteryDetector,
  ) {}

  async detect(): Promise<DeviceCapabilities> {
    const [gpuInfo, batteryInfo] = await Promise.all([this.gpu.detect(), this.battery.detect()]);
    const platform = mapPlatform(this.os.platform());

    return {
      cpuCores: this.os.cpus().length,
      totalRamGB: this.os.totalmem() / 1024 ** 3,
      freeRamGB: this.os.freemem() / 1024 ** 3,
      hasGpu: gpuInfo.hasGpu,
      ...(gpuInfo.vramGB !== undefined ? { gpuVramGB: gpuInfo.vramGB } : {}),
      ...(batteryInfo.batteryPercent !== undefined
        ? { batteryPercent: batteryInfo.batteryPercent }
        : {}),
      ...(batteryInfo.isCharging !== undefined ? { isCharging: batteryInfo.isCharging } : {}),
      platform,
      isAppleSilicon: platform === "macos" && this.os.arch() === "arm64",
    };
  }
}

export function createDeviceCapabilityDetector(
  os: OsLike,
  gpu?: GpuDetector,
  battery?: BatteryDetector,
): DeviceCapabilityDetector {
  return new DeviceCapabilityDetector(os, gpu, battery);
}

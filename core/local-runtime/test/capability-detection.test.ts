import { describe, expect, it } from "vitest";
import { DeviceCapabilityDetector, type OsLike } from "../src/capability-detection.js";

const fakeOs: OsLike = {
  cpus: () => new Array(8).fill({}),
  totalmem: () => 16 * 1024 ** 3,
  freemem: () => 8 * 1024 ** 3,
  platform: () => "darwin",
  arch: () => "arm64",
};

describe("DeviceCapabilityDetector", () => {
  it("derives cpu/ram figures from the injected os source", async () => {
    const detector = new DeviceCapabilityDetector(fakeOs);
    const caps = await detector.detect();
    expect(caps.cpuCores).toBe(8);
    expect(caps.totalRamGB).toBeCloseTo(16, 5);
    expect(caps.freeRamGB).toBeCloseTo(8, 5);
  });

  it("maps node platform strings to the package's platform enum", async () => {
    const detector = new DeviceCapabilityDetector(fakeOs);
    expect((await detector.detect()).platform).toBe("macos");
  });

  it("flags Apple Silicon only for macOS + arm64", async () => {
    const appleSilicon = new DeviceCapabilityDetector(fakeOs);
    expect((await appleSilicon.detect()).isAppleSilicon).toBe(true);

    const intelMac = new DeviceCapabilityDetector({ ...fakeOs, arch: () => "x64" });
    expect((await intelMac.detect()).isAppleSilicon).toBe(false);

    const linuxArm = new DeviceCapabilityDetector({
      ...fakeOs,
      platform: () => "linux",
      arch: () => "arm64",
    });
    expect((await linuxArm.detect()).isAppleSilicon).toBe(false);
  });

  it("defaults to no GPU/battery signal when no detector is injected", async () => {
    const detector = new DeviceCapabilityDetector(fakeOs);
    const caps = await detector.detect();
    expect(caps.hasGpu).toBe(false);
    expect(caps.batteryPercent).toBeUndefined();
  });

  it("uses injected GPU and battery detectors when provided", async () => {
    const detector = new DeviceCapabilityDetector(
      fakeOs,
      { detect: async () => ({ hasGpu: true, vramGB: 24 }) },
      { detect: async () => ({ batteryPercent: 42, isCharging: true }) },
    );
    const caps = await detector.detect();
    expect(caps.hasGpu).toBe(true);
    expect(caps.gpuVramGB).toBe(24);
    expect(caps.batteryPercent).toBe(42);
    expect(caps.isCharging).toBe(true);
  });
});

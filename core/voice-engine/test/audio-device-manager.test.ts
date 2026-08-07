import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { AudioDeviceManager, type AudioDeviceSource } from "../src/audio-device-manager.js";
import { sampleDevice } from "./fixtures.js";

function fakeSource(devices: ReturnType<typeof sampleDevice>[]): AudioDeviceSource {
  return {
    listDevices: async () => devices,
    hasPermission: async () => true,
    requestPermission: async () => true,
  };
}

describe("AudioDeviceManager", () => {
  it("refresh() populates the device list", async () => {
    const manager = new AudioDeviceManager(fakeSource([sampleDevice()]));
    const devices = await manager.refresh();
    expect(devices).toHaveLength(1);
    expect(manager.list("microphone")).toHaveLength(1);
  });

  it("emits connected/disconnected events on hot-swap between refreshes", async () => {
    let devices = [sampleDevice({ id: "mic-1" })];
    const eventBus = new EventBus();
    const seen: string[] = [];
    eventBus.on("voice_engine.device_connected", () => seen.push("connected"));
    eventBus.on("voice_engine.device_disconnected", () => seen.push("disconnected"));

    const manager = new AudioDeviceManager(
      {
        listDevices: async () => devices,
        hasPermission: async () => true,
        requestPermission: async () => true,
      },
      eventBus,
    );
    await manager.refresh();
    expect(seen).toEqual(["connected"]);

    devices = [sampleDevice({ id: "mic-2" })];
    await manager.refresh();
    expect(seen).toEqual(["connected", "connected", "disconnected"]);
  });

  it("getDefault() falls back to the OS-flagged default device", async () => {
    const manager = new AudioDeviceManager(
      fakeSource([
        sampleDevice({ id: "a", isDefault: false }),
        sampleDevice({ id: "b", isDefault: true }),
      ]),
    );
    await manager.refresh();
    expect(manager.getDefault("microphone")?.id).toBe("b");
  });

  it("setDefault() overrides the OS default once the device is known", async () => {
    const manager = new AudioDeviceManager(
      fakeSource([
        sampleDevice({ id: "a", isDefault: true }),
        sampleDevice({ id: "b", isDefault: false }),
      ]),
    );
    await manager.refresh();
    manager.setDefault("microphone", "b");
    expect(manager.getDefault("microphone")?.id).toBe("b");
  });

  it("setDefault() throws for an unknown device id", async () => {
    const manager = new AudioDeviceManager(fakeSource([sampleDevice({ id: "a" })]));
    await manager.refresh();
    expect(() => manager.setDefault("microphone", "unknown")).toThrow();
  });

  it("requestPermission() delegates to the source", async () => {
    const manager = new AudioDeviceManager(fakeSource([]));
    expect(await manager.requestPermission("microphone")).toBe(true);
  });
});

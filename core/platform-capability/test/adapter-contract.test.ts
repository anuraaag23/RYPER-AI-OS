import { describe, expect, it } from "vitest";
import { createNullAdapter, UnsupportedCapabilityError } from "../src/adapter-contract.js";

describe("createNullAdapter", () => {
  it("honestly reports no domain as supported", () => {
    const adapter = createNullAdapter("linux");
    expect(adapter.supports("notifications")).toBe(false);
    expect(adapter.supports("anything")).toBe(false);
  });

  it("throws a clear UnsupportedCapabilityError on invoke", async () => {
    const adapter = createNullAdapter("linux");
    await expect(adapter.invoke("notifications", "send", {}, {} as never)).rejects.toThrow(
      UnsupportedCapabilityError,
    );
  });

  it("reports a runtime limitation explaining why nothing is supported", () => {
    const adapter = createNullAdapter("ios");
    expect(adapter.getRuntimeLimitations()[0]?.reason).toContain("ios");
  });

  it("reports honest 'unknown' device info", () => {
    const adapter = createNullAdapter("android");
    const info = adapter.getDeviceInfo();
    expect(info.platform).toBe("android");
    expect(info.deviceType).toBe("unknown");
    expect(info.hardwareFeatures).toEqual([]);
  });
});

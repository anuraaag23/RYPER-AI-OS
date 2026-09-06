import { describe, expect, it } from "vitest";
import { InMemoryWindowsSystemApi } from "../src/reference-system-api.js";
import { createWindowsVersionDetector, isSupportedOnRelease } from "../src/version-detector.js";

describe("isSupportedOnRelease", () => {
  it("disables clipboard history on Windows 10", () => {
    expect(isSupportedOnRelease("windows-10", "clipboard.history")).toBe(false);
    expect(isSupportedOnRelease("windows-11", "clipboard.history")).toBe(true);
  });

  it("treats an unsupported release as supporting nothing", () => {
    expect(isSupportedOnRelease("unsupported", "application_control.launch")).toBe(false);
  });

  it("defaults unlisted operations to supported on both releases", () => {
    expect(isSupportedOnRelease("windows-10", "application_control.launch")).toBe(true);
    expect(isSupportedOnRelease("windows-11", "application_control.launch")).toBe(true);
  });
});

describe("WindowsVersionDetector", () => {
  it("caches the detected version across calls", async () => {
    let calls = 0;
    const api = new InMemoryWindowsSystemApi();
    const original = api.detectWindowsVersion.bind(api);
    api.detectWindowsVersion = async () => {
      calls += 1;
      return original();
    };
    const detector = createWindowsVersionDetector(api);
    await detector.detect();
    await detector.detect();
    expect(calls).toBe(1);
  });

  it("is optimistic (returns true) before detect() has ever run", () => {
    const api = new InMemoryWindowsSystemApi();
    const detector = createWindowsVersionDetector(api);
    expect(detector.supportsOperation("clipboard.history")).toBe(true);
  });

  it("reflects the detected release after detect() runs", async () => {
    const api = new InMemoryWindowsSystemApi({
      windowsVersion: {
        release: "windows-10",
        buildNumber: "10.0.19045",
        displayName: "Windows 10 22H2",
      },
    });
    const detector = createWindowsVersionDetector(api);
    await detector.detect();
    expect(detector.supportsOperation("clipboard.history")).toBe(false);
  });

  it("assertSupported() throws for an unsupported release", async () => {
    const api = new InMemoryWindowsSystemApi({
      windowsVersion: { release: "unsupported", buildNumber: "6.1.7601", displayName: "Windows 7" },
    });
    const detector = createWindowsVersionDetector(api);
    await expect(detector.assertSupported()).rejects.toThrow(/not a supported release/);
  });
});

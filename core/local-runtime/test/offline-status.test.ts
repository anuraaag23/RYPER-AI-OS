import { describe, expect, it, vi } from "vitest";
import { OfflineStatusDetector } from "../src/offline-status.js";

describe("OfflineStatusDetector", () => {
  it("returns the probe result", async () => {
    const detector = new OfflineStatusDetector(async () => true);
    expect(await detector.isOnline()).toBe(true);
  });

  it("caches the result until the TTL elapses", async () => {
    const probe = vi.fn(async () => true);
    let now = 0;
    const detector = new OfflineStatusDetector(probe, 1000, () => now);

    await detector.isOnline();
    now += 500;
    await detector.isOnline();
    expect(probe).toHaveBeenCalledTimes(1);

    now += 600; // total 1100ms, past the 1000ms TTL
    await detector.isOnline();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("invalidate() forces a re-probe on the next call", async () => {
    const probe = vi.fn(async () => true);
    const detector = new OfflineStatusDetector(probe, 10_000);
    await detector.isOnline();
    detector.invalidate();
    await detector.isOnline();
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

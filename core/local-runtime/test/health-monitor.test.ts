import { describe, expect, it } from "vitest";
import { RuntimeHealthMonitor } from "../src/health-monitor.js";

describe("RuntimeHealthMonitor", () => {
  it("starts healthy for a provider with no recorded events", () => {
    const monitor = new RuntimeHealthMonitor();
    expect(monitor.getStatus("p1")).toBe("healthy");
    expect(monitor.isUsable("p1")).toBe(true);
  });

  it("transitions healthy -> degraded -> unavailable as failures accumulate", () => {
    const monitor = new RuntimeHealthMonitor(2, 4);
    monitor.recordFailure("p1");
    expect(monitor.getStatus("p1")).toBe("healthy");
    monitor.recordFailure("p1");
    expect(monitor.getStatus("p1")).toBe("degraded");
    monitor.recordFailure("p1");
    monitor.recordFailure("p1");
    expect(monitor.getStatus("p1")).toBe("unavailable");
    expect(monitor.isUsable("p1")).toBe(false);
  });

  it("a success immediately resets the failure streak", () => {
    const monitor = new RuntimeHealthMonitor(2, 4);
    monitor.recordFailure("p1");
    monitor.recordFailure("p1");
    monitor.recordFailure("p1");
    expect(monitor.getStatus("p1")).toBe("degraded");
    monitor.recordSuccess("p1");
    expect(monitor.getStatus("p1")).toBe("healthy");
  });

  it("tracks a rolling average latency from recorded successes", () => {
    const monitor = new RuntimeHealthMonitor();
    monitor.recordSuccess("p1", 100);
    monitor.recordSuccess("p1", 200);
    const snapshot = monitor.snapshot("p1");
    expect(snapshot.averageLatencyMs).toBe(150);
  });

  it("reset() clears all recorded state for a provider", () => {
    const monitor = new RuntimeHealthMonitor(1, 2);
    monitor.recordFailure("p1");
    monitor.recordFailure("p1");
    expect(monitor.getStatus("p1")).toBe("unavailable");
    monitor.reset("p1");
    expect(monitor.getStatus("p1")).toBe("healthy");
  });
});

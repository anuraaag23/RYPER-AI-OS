import { describe, expect, it } from "vitest";
import { PluginDiagnostics, PluginMetrics } from "../src/plugin-diagnostics.js";

describe("PluginDiagnostics", () => {
  it("records and filters events by plugin id", () => {
    const diagnostics = new PluginDiagnostics(10);
    diagnostics.record("plugin-a", "loaded");
    diagnostics.record("plugin-b", "loaded");
    diagnostics.record("plugin-a", "enabled", "extra detail");

    expect(diagnostics.recent("plugin-a")).toHaveLength(2);
    expect(diagnostics.recent()).toHaveLength(3);
    expect(diagnostics.recent("plugin-a")[1]?.detail).toBe("extra detail");
  });

  it("evicts the oldest entry once the history size is exceeded", () => {
    const diagnostics = new PluginDiagnostics(2);
    diagnostics.record("plugin-a", "event-1");
    diagnostics.record("plugin-a", "event-2");
    diagnostics.record("plugin-a", "event-3");
    expect(diagnostics.recent().map((e) => e.event)).toEqual(["event-2", "event-3"]);
  });
});

describe("PluginMetrics", () => {
  it("tracks call/error counts and last-known state per plugin", () => {
    const metrics = new PluginMetrics();
    metrics.recordCall("plugin-a", false);
    metrics.recordCall("plugin-a", true);
    metrics.recordState("plugin-a", "enabled");

    const snapshot = metrics.snapshot("plugin-a");
    expect(snapshot).toEqual({
      pluginId: "plugin-a",
      callCount: 2,
      errorCount: 1,
      state: "enabled",
    });
  });

  it("returns undefined for a plugin with no recorded calls", () => {
    expect(new PluginMetrics().snapshot("never-called")).toBeUndefined();
  });

  it("lists all snapshots", () => {
    const metrics = new PluginMetrics();
    metrics.recordCall("plugin-a");
    metrics.recordCall("plugin-b");
    expect(metrics.allSnapshots()).toHaveLength(2);
  });
});

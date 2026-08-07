import { describe, expect, it } from "vitest";
import { createWindowsAdapter } from "../src/windows-adapter.js";
import { buildToolContext } from "./helpers.js";

/**
 * Not a load test — these are cheap, deterministic sanity checks that
 * the in-memory adapter stays fast (the brief's "fast startup, low idle
 * CPU/memory, thread-safe, asynchronous execution" targets) rather than
 * accidentally becoming O(n^2) somewhere. Thresholds are generous on
 * purpose: this is a regression guard, not a strict benchmark.
 */
describe("performance benchmarks", () => {
  it("WindowsAdapter.create() completes quickly", async () => {
    const startedAt = Date.now();
    await createWindowsAdapter();
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it("a single capability invocation completes quickly", async () => {
    const adapter = await createWindowsAdapter();
    const startedAt = Date.now();
    await adapter.invoke("audio", "get_volume", {}, buildToolContext());
    expect(Date.now() - startedAt).toBeLessThan(200);
  });

  it("100 sequential capability invocations complete in bounded time", async () => {
    const adapter = await createWindowsAdapter();
    const startedAt = Date.now();
    for (let i = 0; i < 100; i += 1) {
      await adapter.invoke("device_information", "get_system_info", {}, buildToolContext());
    }
    const elapsedMs = Date.now() - startedAt;
    expect(elapsedMs).toBeLessThan(3000);
  });

  it("concurrent invocations across independent domains do not interfere with each other", async () => {
    const adapter = await createWindowsAdapter();
    const [volume, windows, services] = await Promise.all([
      adapter.invoke("audio", "get_volume", {}, buildToolContext()),
      adapter.invoke("window_management", "enumerate", {}, buildToolContext()),
      adapter.invoke("background_services", "list", {}, buildToolContext()),
    ]);
    expect(typeof volume).toBe("number");
    expect(Array.isArray(windows)).toBe(true);
    expect(Array.isArray(services)).toBe(true);
  });

  it("diagnostics invocation history stays bounded regardless of load", async () => {
    const adapter = await createWindowsAdapter({ diagnosticsHistorySize: 50 });
    for (let i = 0; i < 200; i += 1) {
      await adapter.invoke("audio", "get_volume", {}, buildToolContext());
    }
    expect(adapter.diagnosticsManager.recentInvocations(1000)).toHaveLength(50);
  });
});

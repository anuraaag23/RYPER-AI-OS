import { describe, expect, it } from "vitest";
import { ToolCancellationRegistry } from "../src/tool-cancellation.js";

describe("ToolCancellationRegistry", () => {
  it("issues a signal that reflects cancel()", () => {
    const registry = new ToolCancellationRegistry();
    const signal = registry.begin("inv-1");
    expect(signal.aborted).toBe(false);
    expect(registry.cancel("inv-1", "test reason")).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe("test reason");
  });

  it("reports isCancelled correctly before and after cancellation", () => {
    const registry = new ToolCancellationRegistry();
    registry.begin("inv-1");
    expect(registry.isCancelled("inv-1")).toBe(false);
    registry.cancel("inv-1");
    expect(registry.isCancelled("inv-1")).toBe(true);
  });

  it("returns false when cancelling an unknown invocation", () => {
    const registry = new ToolCancellationRegistry();
    expect(registry.cancel("never-started")).toBe(false);
  });

  it("forgets a disposed invocation", () => {
    const registry = new ToolCancellationRegistry();
    registry.begin("inv-1");
    registry.dispose("inv-1");
    expect(registry.cancel("inv-1")).toBe(false);
    expect(registry.isCancelled("inv-1")).toBe(false);
  });
});

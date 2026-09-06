import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { PluginEventBridge, PluginEventCategoryError } from "../src/event-bridge.js";

describe("PluginEventBridge", () => {
  it("delivers an event whose type matches the requested category's prefix", async () => {
    const bus = new EventBus();
    const bridge = new PluginEventBridge(bus);
    const received: unknown[] = [];
    bridge.subscribe("plugin-a", "planner", "planner.plan.created", (payload) =>
      received.push(payload),
    );
    await bus.emit("planner.plan.created", { planId: "p1" }, "test");
    expect(received).toEqual([{ planId: "p1" }]);
  });

  it("rejects a subscription whose event type doesn't match the category prefix", () => {
    const bridge = new PluginEventBridge(new EventBus());
    expect(() =>
      bridge.subscribe("plugin-a", "planner", "tool.invocation.completed", () => {}),
    ).toThrow(PluginEventCategoryError);
  });

  it("emits an event through the bridge", async () => {
    const bus = new EventBus();
    const bridge = new PluginEventBridge(bus);
    const received: unknown[] = [];
    bus.subscribe({ type: "system.custom" }, (event) => received.push(event.payload));
    await bridge.emit("system.custom", { ok: true }, "plugin:plugin-a");
    expect(received).toEqual([{ ok: true }]);
  });

  it("unsubscribes every subscription a plugin made when told to clean up", async () => {
    const bus = new EventBus();
    const bridge = new PluginEventBridge(bus);
    let calls = 0;
    bridge.subscribe("plugin-a", "system", "system.event", () => {
      calls += 1;
    });
    bridge.unsubscribeAll("plugin-a");
    await bus.emit("system.event", {}, "test");
    expect(calls).toBe(0);
  });

  it("does not affect another plugin's subscriptions when cleaning up one plugin", async () => {
    const bus = new EventBus();
    const bridge = new PluginEventBridge(bus);
    let bCalls = 0;
    bridge.subscribe("plugin-a", "system", "system.event", () => {});
    bridge.subscribe("plugin-b", "system", "system.event", () => {
      bCalls += 1;
    });
    bridge.unsubscribeAll("plugin-a");
    await bus.emit("system.event", {}, "test");
    expect(bCalls).toBe(1);
  });
});

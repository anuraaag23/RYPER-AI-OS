import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../src/index.js";

describe("EventBus", () => {
  it("delivers events only to handlers registered for that type", async () => {
    const bus = new EventBus();
    const matched = vi.fn();
    const unmatched = vi.fn();

    bus.on("file.created", matched);
    bus.on("file.deleted", unmatched);

    await bus.emit("file.created", { path: "/tmp/a.pdf" });

    expect(matched).toHaveBeenCalledTimes(1);
    expect(unmatched).not.toHaveBeenCalled();
    expect(matched.mock.calls[0]?.[0]?.payload).toEqual({ path: "/tmp/a.pdf" });
  });

  it("supports filtered wildcard subscriptions across sources", async () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe({ source: "automation" }, (event) => {
      seen.push(event.type);
    });

    await bus.emit("task.done", {}, "automation");
    await bus.emit("task.done", {}, "plugin:x");

    expect(seen).toEqual(["task.done"]);
  });

  it("unsubscribe stops further delivery", async () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsubscribe = bus.on("ping", handler);

    await bus.emit("ping", null);
    unsubscribe();
    await bus.emit("ping", null);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not let one throwing handler block others", async () => {
    const bus = new EventBus();
    const good = vi.fn();
    bus.on("x", () => {
      throw new Error("boom");
    });
    bus.on("x", good);

    await expect(bus.emit("x", null)).resolves.toBeUndefined();
    expect(good).toHaveBeenCalledTimes(1);
  });
});

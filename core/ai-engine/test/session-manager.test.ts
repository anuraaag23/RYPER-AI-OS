import { describe, expect, it } from "vitest";
import { LongTermMemory } from "@ryper/memory";
import { SessionManager } from "../src/session-manager.js";

describe("SessionManager", () => {
  it("creates a session on first access and returns the same instance after", () => {
    const manager = new SessionManager(new LongTermMemory(), undefined);
    const first = manager.getOrCreate("s1");
    const second = manager.getOrCreate("s1");
    expect(second).toBe(first);
  });

  it("gives each session its own ContextManager instance", () => {
    const manager = new SessionManager(new LongTermMemory(), undefined);
    const a = manager.getOrCreate("a");
    const b = manager.getOrCreate("b");
    a.context.recordUserTurn("hello from a");
    expect(b.context.getShortTermMemory().getTurns()).toHaveLength(0);
  });

  it("end() removes a session", () => {
    const manager = new SessionManager(new LongTermMemory(), undefined);
    manager.getOrCreate("s1");
    expect(manager.end("s1")).toBe(true);
    expect(manager.end("s1")).toBe(false);
  });

  it("evictIdle() removes only sessions past the idle threshold", async () => {
    const manager = new SessionManager(new LongTermMemory(), undefined);
    manager.getOrCreate("stale");
    await new Promise((resolve) => setTimeout(resolve, 30));
    manager.getOrCreate("fresh");

    const evicted = manager.evictIdle(20);
    expect(evicted).toContain("stale");
    expect(evicted).not.toContain("fresh");
  });

  it("list() reflects every active session", () => {
    const manager = new SessionManager(new LongTermMemory(), undefined);
    manager.getOrCreate("a");
    manager.getOrCreate("b");
    expect(
      manager
        .list()
        .map((s) => s.id)
        .sort(),
    ).toEqual(["a", "b"]);
  });
});

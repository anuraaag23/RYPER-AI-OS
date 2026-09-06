import { describe, expect, it } from "vitest";
import { ContextReferenceTracker } from "../electron/context-reference.js";

describe("ContextReferenceTracker", () => {
  it("returns undefined when nothing has ever been set", () => {
    const tracker = new ContextReferenceTracker();
    expect(tracker.get()).toBeUndefined();
  });

  it("returns exactly what was set, plus a timestamp", () => {
    let now = 1000;
    const tracker = new ContextReferenceTracker(undefined, () => now);
    tracker.set({ type: "file", path: "C:/notes.txt", source: "open_file" });
    expect(tracker.get()).toEqual({
      type: "file",
      path: "C:/notes.txt",
      source: "open_file",
      timestamp: 1000,
    });
    now += 1;
    // A later `now()` at read time doesn't rewrite the stored timestamp.
    expect(tracker.get()?.timestamp).toBe(1000);
  });

  it("a later set() replaces the earlier reference entirely, not merges it", () => {
    let now = 0;
    const tracker = new ContextReferenceTracker(undefined, () => now);
    tracker.set({ type: "file", path: "a.txt", name: "A" });
    tracker.set({ type: "url", url: "https://example.com" });
    const current = tracker.get();
    expect(current?.type).toBe("url");
    expect(current?.path).toBeUndefined();
    expect(current?.name).toBeUndefined();
  });

  it("expires a reference once the TTL elapses, and clears it so it doesn't linger", () => {
    let now = 0;
    const tracker = new ContextReferenceTracker(1000, () => now);
    tracker.set({ type: "folder", path: "C:/Downloads" });
    now = 999;
    expect(tracker.get()).toBeDefined();
    now = 1001;
    expect(tracker.get()).toBeUndefined();
    // Once expired, a fresh get() at any later time still finds nothing —
    // it was actually cleared, not just filtered on this one read.
    now = 5000;
    expect(tracker.get()).toBeUndefined();
  });

  it("clear() explicitly invalidates a still-fresh reference", () => {
    const tracker = new ContextReferenceTracker();
    tracker.set({ type: "application", name: "Notepad" });
    expect(tracker.get()).toBeDefined();
    tracker.clear();
    expect(tracker.get()).toBeUndefined();
  });

  it("uses the default multi-minute TTL when none is given", () => {
    let now = 0;
    const tracker = new ContextReferenceTracker(undefined, () => now);
    tracker.set({ type: "media", name: "song.mp3" });
    now = 5 * 60_000; // 5 minutes later
    expect(tracker.get()).toBeDefined();
    now = 11 * 60_000; // 11 minutes later — past the 10 minute default
    expect(tracker.get()).toBeUndefined();
  });
});

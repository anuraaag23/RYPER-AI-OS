import { describe, expect, it } from "vitest";
import { SyncStore } from "../src/index.js";

describe("SyncStore", () => {
  it("keeps the most recently updated value on merge", () => {
    const a = new SyncStore<string>("device-a");
    a.set("title", "hello", 100);

    const applied = a.merge([
      { key: "title", value: "hello v2", updatedAt: 200, deviceId: "device-b" },
    ]);
    expect(applied.applied).toBe(1);
    expect(a.get("title")?.value).toBe("hello v2");
  });

  it("ignores a stale remote update", () => {
    const a = new SyncStore<string>("device-a");
    a.set("title", "current", 500);

    const result = a.merge([
      { key: "title", value: "stale", updatedAt: 100, deviceId: "device-b" },
    ]);
    expect(result.ignored).toBe(1);
    expect(a.get("title")?.value).toBe("current");
  });

  it("breaks exact-timestamp ties deterministically by deviceId", () => {
    const a = new SyncStore<string>("device-a");
    a.set("title", "from-a", 100);
    a.merge([{ key: "title", value: "from-z", updatedAt: 100, deviceId: "device-z" }]);
    // "device-z" > "device-a" lexicographically, so it should win the tie.
    expect(a.get("title")?.value).toBe("from-z");
  });

  it("snapshot() exposes all synced records", () => {
    const a = new SyncStore<number>("device-a");
    a.set("x", 1);
    a.set("y", 2);
    expect(a.snapshot()).toHaveLength(2);
  });
});

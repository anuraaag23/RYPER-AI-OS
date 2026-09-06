import { describe, expect, it } from "vitest";
import { MemoryAuditLog } from "../src/audit-log.js";

describe("MemoryAuditLog", () => {
  it("records every action with actor and timestamp", () => {
    const log = new MemoryAuditLog();
    log.record("create", "mem-1", "user");
    const entries = log.all();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "create", memoryId: "mem-1", actor: "user" });
    expect(() => new Date(entries[0]!.createdAt).toISOString()).not.toThrow();
  });

  it("forMemory filters to just that memory's entries", () => {
    const log = new MemoryAuditLog();
    log.record("create", "mem-1", "user");
    log.record("update", "mem-2", "user");
    log.record("delete", "mem-1", "user");
    expect(log.forMemory("mem-1").map((e) => e.action)).toEqual(["create", "delete"]);
  });
});

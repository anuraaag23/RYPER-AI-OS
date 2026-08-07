import { describe, expect, it } from "vitest";
import { ConflictResolver } from "../src/conflict-resolution.js";
import type { MemoryRecord } from "../src/types.js";

function record(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: overrides.id ?? "id",
    type: "preference",
    content: "x",
    tags: [],
    metadata: {},
    importance: 0.5,
    pinned: false,
    lifecycleState: "active",
    createdAt: "now",
    updatedAt: "2024-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

describe("ConflictResolver", () => {
  it("finds a conflict when two records share a subject but differ in content", () => {
    const resolver = new ConflictResolver();
    const records = [
      record({ id: "a", metadata: { subject: "coffee" }, content: "likes coffee black" }),
      record({ id: "b", metadata: { subject: "coffee" }, content: "likes coffee with milk" }),
    ];
    const conflicts = resolver.findConflicts(records, "subject");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.records).toHaveLength(2);
  });

  it("does not flag records sharing a subject with identical content", () => {
    const resolver = new ConflictResolver();
    const records = [
      record({ id: "a", metadata: { subject: "coffee" }, content: "likes coffee black" }),
      record({ id: "b", metadata: { subject: "coffee" }, content: "likes coffee black" }),
    ];
    expect(resolver.findConflicts(records, "subject")).toHaveLength(0);
  });

  it("resolves most-recent-wins by updatedAt", () => {
    const resolver = new ConflictResolver();
    const older = record({ id: "a", updatedAt: "2024-01-01T00:00:00.000Z" });
    const newer = record({ id: "b", updatedAt: "2024-02-01T00:00:00.000Z" });
    const resolution = resolver.resolve(
      { subjectKey: "subject", subjectValue: "coffee", records: [older, newer] },
      "most-recent-wins",
    );
    expect(resolution.winner?.id).toBe("b");
    expect(resolution.losers.map((r) => r.id)).toEqual(["a"]);
  });

  it("resolves highest-importance-wins by importance", () => {
    const resolver = new ConflictResolver();
    const lowImportance = record({ id: "a", importance: 0.2 });
    const highImportance = record({ id: "b", importance: 0.9 });
    const resolution = resolver.resolve(
      { subjectKey: "subject", subjectValue: "coffee", records: [lowImportance, highImportance] },
      "highest-importance-wins",
    );
    expect(resolution.winner?.id).toBe("b");
  });

  it("manual strategy returns no winner, leaving the decision to the user", () => {
    const resolver = new ConflictResolver();
    const records = [record({ id: "a" }), record({ id: "b" })];
    const resolution = resolver.resolve(
      { subjectKey: "subject", subjectValue: "coffee", records },
      "manual",
    );
    expect(resolution.winner).toBeUndefined();
    expect(resolution.losers).toHaveLength(2);
  });
});

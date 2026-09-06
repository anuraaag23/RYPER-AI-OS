import { describe, expect, it } from "vitest";
import { KnowledgeGraph } from "../src/knowledge_graph/index.js";

describe("KnowledgeGraph", () => {
  it("finds neighbors via a relation in either direction", () => {
    const graph = new KnowledgeGraph();
    graph.upsertEntity({ id: "u1", label: "Alex", kind: "person" });
    graph.upsertEntity({ id: "p1", label: "RYPER launch", kind: "project" });
    graph.addRelation({ from: "u1", to: "p1", type: "owns" });

    expect(graph.neighbors("p1").map((e) => e.id)).toEqual(["u1"]);
    expect(graph.neighbors("u1").map((e) => e.id)).toEqual(["p1"]);
  });

  it("rejects a relation referencing an unknown entity", () => {
    const graph = new KnowledgeGraph();
    graph.upsertEntity({ id: "u1", label: "Alex", kind: "person" });
    expect(() => graph.addRelation({ from: "u1", to: "missing", type: "owns" })).toThrow();
  });

  it("reports graph size", () => {
    const graph = new KnowledgeGraph();
    graph.upsertEntity({ id: "a", label: "A", kind: "x" });
    graph.upsertEntity({ id: "b", label: "B", kind: "x" });
    graph.addRelation({ from: "a", to: "b", type: "related" });
    expect(graph.size()).toEqual({ entities: 2, relations: 1 });
  });
});

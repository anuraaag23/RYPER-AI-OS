import { describe, expect, it } from "vitest";
import { ContextResolver, getPreference, rememberPreference } from "../src/context-resolver.js";
import type { TaskNode } from "../src/types.js";
import { buildMemoryManager } from "./helpers.js";

function task(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "t1",
    taskType: "browser",
    operation: "search",
    description: "search",
    parameters: { query: "interstellar soundtrack" },
    dependsOn: [],
    priority: "normal",
    ...overrides,
  };
}

describe("getPreference / rememberPreference", () => {
  it("returns undefined when no preference has been saved", async () => {
    const memory = buildMemoryManager();
    expect(await getPreference(memory, "browser.search")).toBeUndefined();
  });

  it("round-trips a saved preference", async () => {
    const memory = buildMemoryManager();
    await rememberPreference(memory, "browser.search", "youtube");
    expect(await getPreference(memory, "browser.search")).toBe("youtube");
  });
});

describe("ContextResolver.applyMemoryDefaults", () => {
  it("returns tasks unchanged when no memory manager is configured", async () => {
    const resolver = new ContextResolver();
    const tasks = [task()];
    expect(await resolver.applyMemoryDefaults(tasks)).toBe(tasks);
  });

  it("fills a missing defaultable parameter from a remembered preference", async () => {
    const memory = buildMemoryManager();
    await rememberPreference(memory, "browser.search", "youtube");
    const resolver = new ContextResolver(memory);
    const [resolved] = await resolver.applyMemoryDefaults([task()]);
    expect(resolved?.parameters["site"]).toBe("youtube");
  });

  it("does not override a parameter the task already specifies", async () => {
    const memory = buildMemoryManager();
    await rememberPreference(memory, "browser.search", "youtube");
    const resolver = new ContextResolver(memory);
    const [resolved] = await resolver.applyMemoryDefaults([
      task({ parameters: { query: "x", site: "google" } }),
    ]);
    expect(resolved?.parameters["site"]).toBe("google");
  });
});

describe("ContextResolver.resolveRuntimeReferences", () => {
  it("substitutes a {{taskId.field}} reference with an upstream result", () => {
    const resolver = new ContextResolver();
    const dependent = task({ parameters: { query: "{{t0.title}}" } });
    const results = new Map<string, unknown>([["t0", { title: "Interstellar" }]]);
    const resolved = resolver.resolveRuntimeReferences(dependent, results);
    expect(resolved.parameters["query"]).toBe("Interstellar");
  });

  it("leaves the literal placeholder when the referenced result is missing", () => {
    const resolver = new ContextResolver();
    const dependent = task({ parameters: { query: "{{missing.field}}" } });
    const resolved = resolver.resolveRuntimeReferences(dependent, new Map());
    expect(resolved.parameters["query"]).toBe("{{missing.field}}");
  });

  it("leaves non-reference string parameters untouched", () => {
    const resolver = new ContextResolver();
    const resolved = resolver.resolveRuntimeReferences(task(), new Map());
    expect(resolved.parameters["query"]).toBe("interstellar soundtrack");
  });
});

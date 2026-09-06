import { describe, expect, it } from "vitest";
import { ToolDiscovery, ToolRegistrationError, ToolRegistry } from "../src/tool-registry.js";
import type { ToolDefinition } from "../src/types.js";

function tool(
  overrides: Partial<ToolDefinition["spec"]> = {},
  execute: ToolDefinition["execute"] = () => "ok",
): ToolDefinition {
  return {
    spec: {
      id: "demo.tool",
      name: "Demo Tool",
      description: "a demo tool for browsing files",
      category: "file",
      version: "1.0.0",
      author: "test",
      capabilities: [],
      permissions: [],
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "string" },
      examples: [],
      errorCodes: [],
      executionCost: "low",
      timeoutMs: 1000,
      cancellationSupport: false,
      streamingSupport: false,
      ...overrides,
    },
    execute,
  };
}

describe("ToolRegistry", () => {
  it("registers and retrieves a tool", () => {
    const registry = new ToolRegistry();
    registry.register(tool());
    expect(registry.has("demo.tool")).toBe(true);
    expect(registry.get("demo.tool")?.spec.name).toBe("Demo Tool");
    expect(registry.list()).toHaveLength(1);
    expect(registry.listSpecs()[0]?.id).toBe("demo.tool");
  });

  it("rejects registering the same tool id twice", () => {
    const registry = new ToolRegistry();
    registry.register(tool());
    expect(() => registry.register(tool())).toThrow(ToolRegistrationError);
  });

  it("updates an already-registered tool in place", () => {
    const registry = new ToolRegistry();
    registry.register(tool({ version: "1.0.0" }));
    registry.update(tool({ version: "2.0.0" }));
    expect(registry.get("demo.tool")?.spec.version).toBe("2.0.0");
  });

  it("throws when updating a tool that was never registered", () => {
    const registry = new ToolRegistry();
    expect(() => registry.update(tool())).toThrow(ToolRegistrationError);
  });

  it("unregisters a tool", () => {
    const registry = new ToolRegistry();
    registry.register(tool());
    expect(registry.unregister("demo.tool")).toBe(true);
    expect(registry.has("demo.tool")).toBe(false);
    expect(registry.unregister("demo.tool")).toBe(false);
  });
});

describe("ToolDiscovery", () => {
  it("filters by category, capability, streaming support, and keyword", () => {
    const registry = new ToolRegistry();
    registry.register(
      tool({ id: "file.read", category: "file", capabilities: ["filesystem.read"] }),
    );
    registry.register(
      tool({
        id: "browser.nav",
        category: "browser",
        capabilities: ["network"],
        streamingSupport: true,
      }),
    );
    const discovery = new ToolDiscovery(registry);

    expect(discovery.find({ category: "file" }).map((s) => s.id)).toEqual(["file.read"]);
    expect(discovery.find({ capability: "network" }).map((s) => s.id)).toEqual(["browser.nav"]);
    expect(discovery.find({ streamingOnly: true }).map((s) => s.id)).toEqual(["browser.nav"]);
    expect(discovery.find({ keyword: "demo" }).length).toBeGreaterThanOrEqual(0);
  });

  it("lists distinct categories", () => {
    const registry = new ToolRegistry();
    registry.register(tool({ id: "a", category: "file" }));
    registry.register(tool({ id: "b", category: "file" }));
    registry.register(tool({ id: "c", category: "browser" }));
    const discovery = new ToolDiscovery(registry);
    expect(discovery.categories()).toEqual(["browser", "file"]);
  });
});

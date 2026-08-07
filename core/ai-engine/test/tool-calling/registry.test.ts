import { describe, expect, it } from "vitest";
import { CapabilityBroker } from "@ryper/security";
import { ToolRegistry } from "../../src/tool-calling/registry.js";
import { currentTimeTool } from "../../src/tool-calling/builtin-tools.js";
import type { ToolDefinition } from "../../src/tool-calling/types.js";

describe("ToolRegistry", () => {
  it("executes the built-in get_current_time tool and returns a valid ISO timestamp", async () => {
    const registry = new ToolRegistry();
    registry.register(currentTimeTool);

    const result = await registry.invoke(
      { id: "call1", name: "get_current_time", arguments: {} },
      { sessionId: "s1" },
    );

    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.content) as { iso: string };
    expect(() => new Date(parsed.iso).toISOString()).not.toThrow();
  });

  it("returns a structured failure for an unknown tool instead of throwing", async () => {
    const registry = new ToolRegistry();
    const result = await registry.invoke(
      { id: "call1", name: "does-not-exist", arguments: {} },
      { sessionId: "s1" },
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("unknown tool");
  });

  it("blocks a capability-gated tool until the broker grants it", async () => {
    const broker = new CapabilityBroker(() => true);
    const registry = new ToolRegistry(broker);
    const gatedTool: ToolDefinition = {
      spec: {
        name: "read-file",
        description: "reads a file",
        parameters: { type: "object", properties: {} },
      },
      requiredCapability: "filesystem.read",
      execute: () => "file contents",
    };
    registry.register(gatedTool);

    const blocked = await registry.invoke(
      { id: "c1", name: "read-file", arguments: {} },
      { sessionId: "s1" },
    );
    expect(blocked.ok).toBe(false);

    await broker.requestCapability({
      actorId: "ai-engine",
      capability: "filesystem.read",
      justification: "test",
    });
    const allowed = await registry.invoke(
      { id: "c2", name: "read-file", arguments: {} },
      { sessionId: "s1" },
    );
    expect(allowed.ok).toBe(true);
    expect(allowed.content).toBe("file contents");
  });

  it("contains a throwing tool as a failed result rather than propagating", async () => {
    const registry = new ToolRegistry();
    registry.register({
      spec: {
        name: "boom",
        description: "always throws",
        parameters: { type: "object", properties: {} },
      },
      execute: () => {
        throw new Error("kaboom");
      },
    });

    const result = await registry.invoke(
      { id: "c1", name: "boom", arguments: {} },
      { sessionId: "s1" },
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("kaboom");
  });

  it("listSpecs() exposes every registered tool's spec", () => {
    const registry = new ToolRegistry();
    registry.register(currentTimeTool);
    expect(registry.listSpecs()).toEqual([currentTimeTool.spec]);
  });
});

import { describe, expect, it } from "vitest";
import { ToolMemoryIntegration } from "../src/memory-integration.js";
import type { ToolResult } from "../src/types.js";
import { buildMemoryManager } from "./helpers.js";

function result(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    invocationId: "i1",
    toolId: "t1",
    status: "ok",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1,
    attempts: 1,
    ...overrides,
  };
}

describe("ToolMemoryIntegration", () => {
  it("ranks tools by invocation frequency", async () => {
    const memory = buildMemoryManager();
    const integration = new ToolMemoryIntegration(memory);
    await integration.recordInvocation("system.get_current_time", result());
    await integration.recordInvocation("system.get_current_time", result());
    await integration.recordInvocation("system.text_transform", result());

    const frequent = integration.frequentlyUsedTools();
    expect(frequent[0]).toEqual({ toolId: "system.get_current_time", count: 2 });
  });

  it("round-trips a favorite", async () => {
    const memory = buildMemoryManager();
    const integration = new ToolMemoryIntegration(memory);
    expect(integration.isFavorite("system.get_current_time")).toBe(false);
    await integration.markFavorite("system.get_current_time");
    expect(integration.isFavorite("system.get_current_time")).toBe(true);
    expect(integration.favorites()).toContain("system.get_current_time");
  });

  it("round-trips a per-tool setting and returns the most recent value", async () => {
    const memory = buildMemoryManager();
    const integration = new ToolMemoryIntegration(memory);
    expect(integration.getSetting("system.text_transform", "default_operation")).toBeUndefined();
    await integration.rememberSetting("system.text_transform", "default_operation", "uppercase");
    expect(integration.getSetting("system.text_transform", "default_operation")).toBe("uppercase");
  });
});

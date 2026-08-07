import { describe, expect, it } from "vitest";
import type { ToolSpec } from "@ryper/tool-framework";
import { CapabilityManager } from "../src/capability-manager.js";
import { createCapabilityTool } from "../src/tool-integration.js";
import { buildCapabilityBroker, buildMockAdapter } from "./helpers.js";

function spec(overrides: Partial<ToolSpec> = {}): ToolSpec {
  return {
    id: "notifications.send",
    name: "Send Notification",
    description: "d",
    category: "notifications",
    version: "1.0.0",
    author: "test",
    capabilities: [],
    permissions: [],
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: {} },
    examples: [],
    errorCodes: [],
    executionCost: "low",
    timeoutMs: 1000,
    cancellationSupport: false,
    streamingSupport: false,
    ...overrides,
  };
}

describe("createCapabilityTool", () => {
  it("executes by calling CapabilityManager.invoke — never platform-specific code", async () => {
    const manager = new CapabilityManager({
      broker: buildCapabilityBroker(),
      platformDetector: () => "windows",
    });
    manager.registerAdapter(
      buildMockAdapter({
        platform: "windows",
        supportedDomains: ["notifications"],
        handlers: { "notifications.send": (params) => ({ sent: params["title"] }) },
      }),
    );

    const tool = createCapabilityTool(manager, "notifications", "send", spec());
    const result = await tool.execute(
      { title: "hi" },
      { invocationId: "i1", actorId: "a", sessionId: "s", platform: "windows" },
    );
    expect(result).toEqual({ sent: "hi" });
  });

  it("propagates a manager-level failure (e.g. an unsupported domain) as a thrown error", async () => {
    const manager = new CapabilityManager({
      broker: buildCapabilityBroker(),
      platformDetector: () => "windows",
    });
    manager.registerAdapter(buildMockAdapter({ platform: "windows", supportedDomains: [] }));
    const tool = createCapabilityTool(manager, "notifications", "send", spec());
    await expect(
      tool.execute({}, { invocationId: "i1", actorId: "a", sessionId: "s", platform: "windows" }),
    ).rejects.toThrow();
  });
});

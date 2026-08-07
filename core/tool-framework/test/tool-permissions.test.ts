import { describe, expect, it } from "vitest";
import { ToolPermissionManager } from "../src/tool-permissions.js";
import type { ToolSpec } from "../src/types.js";
import { buildCapabilityBroker } from "./helpers.js";

function spec(overrides: Partial<ToolSpec> = {}): ToolSpec {
  return {
    id: "net.fetch",
    name: "Fetch",
    description: "fetches a network resource",
    category: "network",
    version: "1.0.0",
    author: "test",
    capabilities: ["network"],
    permissions: [{ capability: "network" }],
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

describe("ToolPermissionManager", () => {
  it("requests and reports a granted capability", async () => {
    const manager = new ToolPermissionManager(buildCapabilityBroker(() => true));
    const results = await manager.requestAll(spec(), "actor-1", "test");
    expect(results).toEqual([{ requirement: { capability: "network" }, granted: true }]);
    expect(manager.checkAll(spec(), "actor-1")[0]?.granted).toBe(true);
  });

  it("reports a denied capability without throwing", async () => {
    const manager = new ToolPermissionManager(buildCapabilityBroker(() => false));
    const results = await manager.requestAll(spec(), "actor-1", "test");
    expect(results[0]?.granted).toBe(false);
  });

  it("auto-expires a temporary grant after its TTL", async () => {
    let now = 1_000_000;
    const manager = new ToolPermissionManager(
      buildCapabilityBroker(() => true),
      () => now,
    );
    const temporarySpec = spec({
      permissions: [{ capability: "network", temporary: true, ttlMs: 1000 }],
    });

    await manager.requestAll(temporarySpec, "actor-1", "test");
    expect(manager.checkAll(temporarySpec, "actor-1")[0]?.granted).toBe(true);

    now += 2000; // past the TTL
    expect(manager.checkAll(temporarySpec, "actor-1")[0]?.granted).toBe(false);
  });

  it("revokes all capabilities a tool declares", async () => {
    const broker = buildCapabilityBroker(() => true);
    const manager = new ToolPermissionManager(broker);
    await manager.requestAll(spec(), "actor-1", "test");
    manager.revokeAll(spec(), "actor-1");
    expect(manager.checkAll(spec(), "actor-1")[0]?.granted).toBe(false);
  });
});

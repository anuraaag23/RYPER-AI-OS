import { describe, expect, it } from "vitest";
import { CapabilityResolver, PermissionValidator } from "../src/capability.js";
import type { TaskNode } from "../src/types.js";
import { buildCapabilityBroker } from "./helpers.js";

describe("CapabilityResolver", () => {
  const resolver = new CapabilityResolver();

  it("marks a task type supported on a platform that lists it", () => {
    const resolution = resolver.resolve("browser", "windows");
    expect(resolution.supported).toBe(true);
    expect(resolution.requiredCapability).toBe("network");
  });

  it("produces a graceful alternative for an unsupported task type", () => {
    const resolution = resolver.resolve("call", "linux");
    expect(resolution.supported).toBe(false);
    expect(resolution.alternative).toContain("linux");
  });

  it("resolves a batch of task types at once", () => {
    const resolutions = resolver.resolveAll(["browser", "call"], "web");
    expect(resolutions).toHaveLength(2);
    expect(resolutions[0]?.supported).toBe(true);
    expect(resolutions[1]?.supported).toBe(false);
  });
});

function task(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "t1",
    taskType: "browser",
    operation: "navigate",
    description: "navigate",
    parameters: {},
    dependsOn: [],
    priority: "normal",
    requiredCapability: "network",
    ...overrides,
  };
}

describe("PermissionValidator", () => {
  it("requests and reports a granted capability", async () => {
    const broker = buildCapabilityBroker(() => true);
    const validator = new PermissionValidator(broker);
    const results = await validator.validate([task()], "actor-1");
    expect(results).toEqual([{ taskId: "t1", capability: "network", granted: true }]);
  });

  it("reports a denied capability without throwing", async () => {
    const broker = buildCapabilityBroker(() => false);
    const validator = new PermissionValidator(broker);
    const results = await validator.validate([task()], "actor-1");
    expect(results[0]?.granted).toBe(false);
  });

  it("skips tasks with no required capability", async () => {
    const broker = buildCapabilityBroker(() => true);
    const validator = new PermissionValidator(broker);
    const noCapabilityTask: TaskNode = {
      id: "t2",
      taskType: "note",
      operation: "create",
      description: "note",
      parameters: {},
      dependsOn: [],
      priority: "normal",
    };
    const results = await validator.validate([noCapabilityTask], "actor-1");
    expect(results).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { ExecutionQueue, TaskGraph } from "@ryper/planner";
import type { ExecutionPlan, TaskNode } from "@ryper/planner";
import { ToolManager } from "../src/tool-manager.js";
import { PlannerToolBridge } from "../src/planner-integration.js";
import type { ToolDefinition } from "../src/types.js";
import { buildCapabilityBroker, buildMemoryManager, buildPluginRuntime } from "./helpers.js";

describe("ToolManager — built-in tools", () => {
  it("registers built-in tools by default and can invoke one end-to-end", async () => {
    const manager = new ToolManager();
    expect(manager.registry.has("system.get_current_time")).toBe(true);

    const result = await manager.invoke(
      "system.get_current_time",
      {},
      "actor-1",
      "session-1",
      "windows",
    );
    expect(result.status).toBe("ok");
    expect(manager.diagnostics.totalInvocations()).toBe(1);
    expect(manager.metrics.snapshot("system.get_current_time")?.invocations).toBe(1);
    expect(manager.logger.findByToolId("system.get_current_time")).toHaveLength(1);
  });

  it("can skip built-in tool registration", () => {
    const manager = new ToolManager({ registerBuiltinTools: false });
    expect(manager.registry.list()).toHaveLength(0);
  });

  it("returns a framework-level error for an unknown tool without throwing", async () => {
    const manager = new ToolManager();
    const result = await manager.invoke("does.not.exist", {}, "actor-1", "session-1", "windows");
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("framework.unknown_tool");
  });
});

describe("ToolManager — custom tool registration and discovery", () => {
  it("registers a custom tool and finds it via discover()", async () => {
    const manager = new ToolManager({ registerBuiltinTools: false });
    const tool: ToolDefinition = {
      spec: {
        id: "custom.greet",
        name: "Greet",
        description: "says hello",
        category: "ai",
        version: "1.0.0",
        author: "test",
        capabilities: [],
        permissions: [],
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
        outputSchema: {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
        },
        examples: [],
        errorCodes: [],
        executionCost: "free",
        timeoutMs: 500,
        cancellationSupport: false,
        streamingSupport: false,
      },
      execute: (params) => ({ message: `Hello, ${String(params["name"])}!` }),
    };
    manager.registerTool(tool);
    expect(manager.discover({ category: "ai" }).map((s) => s.id)).toEqual(["custom.greet"]);

    const result = await manager.invoke(
      "custom.greet",
      { name: "Riya" },
      "actor-1",
      "session-1",
      "windows",
    );
    expect(result.status).toBe("ok");
    expect(result.value).toEqual({ message: "Hello, Riya!" });
  });
});

describe("ToolManager — permission-gated tool", () => {
  it("denies invocation when the capability broker denies the request", async () => {
    const manager = new ToolManager({
      registerBuiltinTools: false,
      capabilityBroker: buildCapabilityBroker(() => false),
    });
    const tool: ToolDefinition = {
      spec: {
        id: "net.fetch",
        name: "Fetch",
        description: "fetches a resource",
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
        timeoutMs: 500,
        cancellationSupport: false,
        streamingSupport: false,
      },
      execute: () => ({}),
    };
    manager.registerTool(tool);
    const result = await manager.invoke("net.fetch", {}, "actor-1", "session-1", "windows");
    expect(result.status).toBe("permission_denied");
  });
});

describe("ToolManager — memory integration", () => {
  it("records every invocation as tool-usage history", async () => {
    const memory = buildMemoryManager();
    const manager = new ToolManager({ memory });
    await manager.invoke("system.get_current_time", {}, "actor-1", "session-1", "windows");
    const frequent = manager.memoryIntegration?.frequentlyUsedTools();
    expect(frequent?.[0]?.toolId).toBe("system.get_current_time");
  });
});

describe("ToolManager — plugin integration", () => {
  it("makes a plugin-registered tool invocable through the same invoke() path", async () => {
    const runtime = buildPluginRuntime();
    runtime.register(
      {
        id: "weather-plugin",
        name: "Weather",
        version: "1.0.0",
        requestedCapabilities: [],
        signed: false,
      },
      [{ name: "get_forecast", handler: () => ({ sunny: true }) }],
    );
    const manager = new ToolManager({ registerBuiltinTools: false, pluginRuntime: runtime });
    manager.pluginBridge?.registerPluginTool({
      pluginId: "weather-plugin",
      actionName: "get_forecast",
      spec: {
        id: "weather.forecast",
        name: "Forecast",
        description: "gets the forecast",
        category: "plugin",
        version: "1.0.0",
        author: "weather-plugin",
        capabilities: [],
        permissions: [],
        inputSchema: { type: "object", properties: {} },
        outputSchema: { type: "object", properties: {} },
        examples: [],
        errorCodes: [],
        executionCost: "low",
        timeoutMs: 500,
        cancellationSupport: false,
        streamingSupport: false,
      },
    });

    const result = await manager.invoke("weather.forecast", {}, "actor-1", "session-1", "windows");
    expect(result.status).toBe("ok");
    expect(result.value).toEqual({ sunny: true });
  });
});

describe("ToolManager — cancellation and events", () => {
  it("allows cancelling an unknown invocation id as a safe no-op, and the real call still completes", async () => {
    const manager = new ToolManager({ registerBuiltinTools: false });
    const tool: ToolDefinition = {
      spec: {
        id: "slow.op",
        name: "Slow",
        description: "a slow operation",
        category: "system",
        version: "1.0.0",
        author: "test",
        capabilities: [],
        permissions: [],
        inputSchema: { type: "object", properties: {} },
        outputSchema: { type: "object", properties: {} },
        examples: [],
        errorCodes: [],
        executionCost: "high",
        timeoutMs: 5000,
        cancellationSupport: true,
        streamingSupport: false,
      },
      execute: () => new Promise((resolve) => setTimeout(() => resolve({}), 50)),
    };
    manager.registerTool(tool);

    const resultPromise = manager.invoke("slow.op", {}, "actor-1", "session-1", "windows");
    expect(manager.cancel("not-a-real-id")).toBe(false);
    const result = await resultPromise;
    expect(result.status).toBe("ok");
  });

  it("emits tool.invocation.completed on the event bus", async () => {
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe({ type: "tool.invocation.completed" }, (event) => events.push(event.payload));
    const manager = new ToolManager({ eventBus: bus });
    await manager.invoke("system.get_current_time", {}, "actor-1", "session-1", "windows");
    expect(events).toHaveLength(1);
  });
});

describe("ToolManager — full pipeline simulation via PlannerToolBridge", () => {
  it("drives a real @ryper/planner ExecutionQueue end-to-end through registered tools", async () => {
    const manager = new ToolManager();
    const bridge = new PlannerToolBridge(manager);
    bridge.registerRoute("ai", "respond", "system.get_current_time");

    function task(id: string, dependsOn: readonly string[] = []): TaskNode {
      return {
        id,
        taskType: "ai",
        operation: "respond",
        description: id,
        parameters: {},
        dependsOn,
        priority: "normal",
      };
    }
    const plan: ExecutionPlan = {
      id: "plan-1",
      tasks: [task("t1"), task("t2", ["t1"])],
      executionLevels: [],
      metadata: {
        createdAt: new Date().toISOString(),
        sourceRequest: "test",
        platform: "windows",
        intentShape: "multi_step",
      },
      diagnostics: [],
    };
    const queue = new ExecutionQueue(new TaskGraph(plan.tasks));
    await bridge.runToCompletion(queue, plan, "actor-1", "session-1", "windows");

    expect(queue.isComplete()).toBe(true);
    expect(queue.snapshot().every((s) => s.state === "succeeded")).toBe(true);
    expect(manager.diagnostics.totalInvocations()).toBe(2);
  });
});

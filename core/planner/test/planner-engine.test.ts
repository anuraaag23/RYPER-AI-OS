import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { PlannerEngine, createPlannerEngine } from "../src/planner-engine.js";
import { ToolSelector } from "../src/tool-selector.js";
import { rememberPreference } from "../src/context-resolver.js";
import { buildCapabilityBroker, buildMemoryManager } from "./helpers.js";

describe("PlannerEngine.plan — simple command", () => {
  it("builds a one-task plan for 'Open Calculator.'", async () => {
    const engine = new PlannerEngine();
    const plan = await engine.plan({ text: "Open Calculator.", platform: "windows" });
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]?.taskType).toBe("application");
    expect(plan.executionLevels).toEqual([[plan.tasks[0]?.id]]);
    expect(plan.metadata.intentShape).toBe("simple");
  });
});

describe("PlannerEngine.plan — multi-step request", () => {
  it("chains four sequential tasks for the YouTube/search/play/volume example", async () => {
    const engine = new PlannerEngine();
    const plan = await engine.plan({
      text: "Open YouTube, search for Interstellar soundtrack, play the first result, then lower the volume.",
      platform: "windows",
    });
    expect(plan.tasks).toHaveLength(4);
    // fully sequential -> one task per execution level
    expect(plan.executionLevels).toHaveLength(4);
    expect(plan.tasks.every((t) => t.retryPolicy)).toBe(true);
  });
});

describe("PlannerEngine.plan — parallel request", () => {
  it("places independent branches in the same execution level", async () => {
    const engine = new PlannerEngine();
    const plan = await engine.plan({
      text: "Summarize this PDF while downloading today's emails.",
      platform: "windows",
    });
    expect(plan.tasks).toHaveLength(2);
    expect(plan.executionLevels).toEqual([expect.arrayContaining(plan.tasks.map((t) => t.id))]);
    expect(plan.executionLevels[0]).toHaveLength(2);
  });
});

describe("PlannerEngine.plan — conditional request", () => {
  it("captures the schedule-free conditional shape", async () => {
    const engine = new PlannerEngine();
    const plan = await engine.plan({ text: "If Wi-Fi disconnects, notify me.", platform: "macos" });
    expect(plan.metadata.intentShape).toBe("conditional");
    expect(plan.tasks[0]?.taskType).toBe("message");
  });
});

describe("PlannerEngine.plan — scheduled request", () => {
  it("attaches a ScheduleSpec to the plan", async () => {
    const engine = new PlannerEngine();
    const plan = await engine.plan({
      text: "Every morning at 7 AM read my calendar.",
      platform: "macos",
    });
    expect(plan.metadata.intentShape).toBe("scheduled");
    expect(plan.schedule).toEqual({ recurrence: "daily", atTime: "07:00" });
    expect(plan.tasks[0]?.taskType).toBe("calendar");
  });
});

describe("PlannerEngine.plan — recursive request", () => {
  it("marks the plan recursive with a weekdays schedule", async () => {
    const engine = new PlannerEngine();
    const plan = await engine.plan({
      text: "Repeat this workflow every weekday.",
      platform: "windows",
    });
    expect(plan.metadata.intentShape).toBe("recursive");
    expect(plan.schedule?.recurrence).toBe("weekdays");
  });
});

describe("PlannerEngine.plan — graceful degradation", () => {
  it("routes an unsupported task type on the current platform to a diagnostic + fallback recovery task", async () => {
    const engine = new PlannerEngine();
    // "call" tasks aren't in the linux support set.
    const plan = await engine.plan({ text: "call mom", platform: "linux" });
    const callTask = plan.tasks.find((t) => t.taskType === "call");
    expect(callTask?.recovery?.fallbackTask?.taskType).toBe("ai");
    expect(plan.diagnostics.some((d) => d.includes("linux"))).toBe(true);
  });
});

describe("PlannerEngine.plan — memory-backed defaults", () => {
  it("fills a missing browser search 'site' parameter from a remembered preference", async () => {
    const memory = buildMemoryManager();
    await rememberPreference(memory, "browser.search", "youtube");
    const engine = new PlannerEngine({ memory });

    const plan = await engine.plan({ text: "search for lofi beats", platform: "windows" });
    const searchTask = plan.tasks.find((t) => t.operation === "search");
    expect(searchTask?.parameters["site"]).toBe("youtube");
  });
});

describe("PlannerEngine.plan — permission validation", () => {
  it("notes a denied capability in plan diagnostics without throwing", async () => {
    const broker = buildCapabilityBroker(() => false);
    const engine = new PlannerEngine({ capabilityBroker: broker });
    const plan = await engine.plan({
      text: "download the report",
      platform: "windows",
      actorId: "user-1",
    });
    expect(plan.diagnostics.some((d) => d.includes("was not granted"))).toBe(true);
  });
});

describe("PlannerEngine — plugin task routing", () => {
  it("resolves a registered plugin task schema through the engine's public plugin registry", () => {
    const engine = new PlannerEngine();
    engine.registerPluginTaskSchema({
      pluginId: "weather-plugin",
      operation: "get_forecast",
      description: "Gets a weather forecast",
      parameterNames: ["city"],
    });
    // The engine's plugin registry is the discovery point future plugin-typed
    // tasks route through; verify it round-trips what was registered.
    expect(engine.pluginRegistry.find("get_forecast")?.pluginId).toBe("weather-plugin");

    const selector = new ToolSelector(engine.pluginRegistry);
    const route = selector.select({
      id: "t1",
      taskType: "plugin",
      operation: "get_forecast",
      description: "weather",
      parameters: {},
      dependsOn: [],
      priority: "normal",
    });
    expect(route).toEqual({
      kind: "plugin",
      pluginId: "weather-plugin",
      operation: "get_forecast",
    });
  });
});

describe("PlannerEngine — diagnostics + event bus", () => {
  it("records every built plan in diagnostics and emits planner.plan.created", async () => {
    const bus = new EventBus();
    const events: string[] = [];
    bus.subscribe({ type: "planner.plan.created" }, () => events.push("created"));

    const engine = createPlannerEngine({ eventBus: bus });
    await engine.plan({ text: "Open Calculator.", platform: "windows" });
    await engine.plan({ text: "Open Notepad.", platform: "windows" });

    expect(engine.diagnostics.totalPlansBuilt()).toBe(2);
    expect(events).toEqual(["created", "created"]);
  });
});

describe("PlannerEngine — end-to-end simulation via ExecutionQueue", () => {
  it("drives a full multi-step plan through to completion using buildExecutionQueue", async () => {
    const engine = new PlannerEngine();
    const plan = await engine.plan({
      text: "Open Calculator, then lower the volume.",
      platform: "windows",
    });

    const queue = engine.buildExecutionQueue(plan);
    let guard = 0;
    while (!queue.isComplete() && guard < 10) {
      guard += 1;
      const ready = queue.dequeueReady();
      for (const task of ready) {
        queue.markRunning(task.id);
        queue.markSucceeded(task.id, { ok: true });
      }
    }
    expect(queue.isComplete()).toBe(true);
    expect(queue.snapshot().every((s) => s.state === "succeeded")).toBe(true);
  });

  it("records a successful plan as a memory workflow when memory integration is enabled", async () => {
    const memory = buildMemoryManager();
    const engine = new PlannerEngine({ memory });
    const plan = await engine.plan({ text: "Open Calculator.", platform: "windows" });
    await engine.recordSuccessfulPlan(plan);

    const stored = memory.filterMemories({ type: "task", tag: "workflow" });
    expect(stored).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { PlannerMemoryIntegration } from "../src/memory-integration.js";
import type { ExecutionPlan, ParsedIntent } from "../src/types.js";
import { buildMemoryManager } from "./helpers.js";

const intent: ParsedIntent = {
  raw: "open calculator",
  shape: "simple",
  clauses: ["open calculator"],
  parallel: false,
  recursive: false,
};

function plan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    id: "plan-1",
    tasks: [],
    executionLevels: [],
    metadata: {
      createdAt: new Date().toISOString(),
      sourceRequest: "open calculator",
      platform: "windows",
      intentShape: "simple",
    },
    diagnostics: [],
    ...overrides,
  };
}

describe("PlannerMemoryIntegration", () => {
  it("recalls no memories when nothing has been stored yet", async () => {
    const integration = new PlannerMemoryIntegration(buildMemoryManager());
    expect(await integration.recallForIntent(intent)).toHaveLength(0);
  });

  it("records a successful plan as a workflow memory", async () => {
    const memory = buildMemoryManager();
    const integration = new PlannerMemoryIntegration(memory);
    await integration.recordWorkflow(plan());

    const stored = memory.filterMemories({ type: "task", tag: "workflow" });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.content).toBe("open calculator");
  });

  it("recalls a previously recorded workflow by searching the same request text", async () => {
    const memory = buildMemoryManager();
    const integration = new PlannerMemoryIntegration(memory);
    await integration.recordWorkflow(plan());

    const recalled = await integration.recallForIntent(intent);
    expect(recalled.length).toBeGreaterThan(0);
  });

  it("recallKnownRoutines only matches automation-typed memories", async () => {
    const memory = buildMemoryManager();
    const integration = new PlannerMemoryIntegration(memory);
    await memory.createMemoryAuto("open calculator every morning", { type: "automation" }, "user");
    await memory.createMemoryAuto("open calculator", { type: "task" }, "user");

    const routines = await integration.recallKnownRoutines(intent);
    expect(routines.length).toBeGreaterThan(0);
    expect(routines.every((r) => r.record.type === "automation")).toBe(true);
  });
});

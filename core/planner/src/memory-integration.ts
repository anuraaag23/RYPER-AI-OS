import type { MemoryManager, ScoredMemory } from "@ryper/memory-system";
import type { ExecutionPlan, ParsedIntent } from "./types.js";

/**
 * Retrieves memories relevant to planning a given request — frequently
 * used apps, preferred services, prior workflows, saved automations,
 * known routines — entirely through `MemoryManager`'s public API. This
 * package never touches `MemoryStore`/`MemoryIndex` directly, matching
 * the brief's "reuse `MemoryManager` through its public API" instruction.
 */
export class PlannerMemoryIntegration {
  constructor(private readonly memory: MemoryManager) {}

  async recallForIntent(intent: ParsedIntent, limit = 5): Promise<readonly ScoredMemory[]> {
    return this.memory.searchMemories(intent.raw, { limit }, "planner");
  }

  /** Known routines: previously saved automations/workflows whose content mentions this request. */
  async recallKnownRoutines(intent: ParsedIntent, limit = 3): Promise<readonly ScoredMemory[]> {
    const results = await this.memory.searchMemories(
      intent.raw,
      { filter: { type: "automation" }, limit },
      "planner",
    );
    return results;
  }

  /**
   * Saves a successfully-built plan as a `task`-typed memory tagged
   * `workflow`, so a future identical or similar request can be recalled
   * as a known routine rather than re-derived from scratch.
   */
  async recordWorkflow(plan: ExecutionPlan): Promise<void> {
    await this.memory.createMemoryAuto(
      plan.metadata.sourceRequest,
      {
        type: "task",
        tags: ["workflow", `intent:${plan.metadata.intentShape}`],
        metadata: { planId: plan.id, taskCount: plan.tasks.length },
      },
      "planner",
    );
  }
}

export function createPlannerMemoryIntegration(memory: MemoryManager): PlannerMemoryIntegration {
  return new PlannerMemoryIntegration(memory);
}

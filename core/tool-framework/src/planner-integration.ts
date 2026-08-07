import type { ExecutionPlan, ExecutionQueue, TaskNode } from "@ryper/planner";
import { createLogger } from "@ryper/logging";
import type { ToolInvoker } from "./voice-integration.js";
import type { ToolPlatform } from "./types.js";

const log = createLogger("tool-framework:planner-bridge");

function routeKey(taskType: string, operation: string): string {
  return `${taskType}.${operation}`;
}

/**
 * Completes the brief's pipeline — "Planner → Tool Calling Framework →
 * Platform Adapter → Execution" — at the framework layer: it drives an
 * `@ryper/planner` `ExecutionQueue`, mapping each ready `TaskNode` to a
 * registered tool id and invoking it through this framework. The Planner
 * never calls platform code directly; it only produces the plan and the
 * queue, and this bridge is the (still platform-independent) thing that
 * turns queue entries into tool calls. The actual OS/app work happens
 * inside whichever `ToolDefinition.execute` a platform adapter registers
 * — this bridge has no OS-specific code of its own.
 */
export class PlannerToolBridge {
  private readonly routes = new Map<string, string>();

  constructor(private readonly invoker: ToolInvoker) {}

  registerRoute(taskType: string, operation: string, toolId: string): void {
    this.routes.set(routeKey(taskType, operation), toolId);
  }

  routeFor(task: TaskNode): string | undefined {
    return this.routes.get(routeKey(task.taskType, task.operation));
  }

  /**
   * Drives `queue` to completion, invoking a mapped tool for every task
   * that becomes ready and feeding the result back via
   * `markSucceeded`/`markFailed`. Stops early (without throwing) if the
   * queue is neither complete nor producing new ready work — e.g. it was
   * cancelled out-of-band — so this never spins forever.
   */
  async runToCompletion(
    queue: ExecutionQueue,
    plan: ExecutionPlan,
    actorId: string,
    sessionId: string,
    platform: ToolPlatform,
    maxIterations = 1000,
  ): Promise<void> {
    let iterations = 0;
    while (!queue.isComplete() && iterations < maxIterations) {
      iterations += 1;
      const ready = queue.dequeueReady();
      if (ready.length === 0) {
        log.warn("execution queue produced no ready work but isn't complete; stopping", {
          planId: plan.id,
        });
        return;
      }
      await Promise.all(
        ready.map((task) => this.runOne(queue, task, actorId, sessionId, platform)),
      );
    }
  }

  private async runOne(
    queue: ExecutionQueue,
    task: TaskNode,
    actorId: string,
    sessionId: string,
    platform: ToolPlatform,
  ): Promise<void> {
    queue.markRunning(task.id);
    const toolId = this.routeFor(task);
    if (!toolId) {
      queue.markFailed(
        task.id,
        `no tool route registered for "${routeKey(task.taskType, task.operation)}"`,
      );
      return;
    }
    const result = await this.invoker.invoke(toolId, task.parameters, actorId, sessionId, platform);
    if (result.status === "ok") {
      queue.markSucceeded(task.id, result.value);
    } else {
      queue.markFailed(task.id, result.errorMessage ?? result.status);
    }
  }
}

export function createPlannerToolBridge(invoker: ToolInvoker): PlannerToolBridge {
  return new PlannerToolBridge(invoker);
}

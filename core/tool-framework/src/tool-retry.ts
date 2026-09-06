import type { ExecutionCost, ToolResult, ToolSpec } from "./types.js";

export interface ToolRetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMs: number;
  readonly backoffMultiplier: number;
}

const COST_TO_RETRIES: Readonly<Record<ExecutionCost, number>> = {
  free: 3,
  low: 3,
  medium: 2,
  high: 1,
};

/** Retryable result statuses — validation/permission failures are never worth retrying unchanged. */
const RETRYABLE_STATUSES = new Set<ToolResult["status"]>(["timeout", "error"]);

/**
 * Derives a retry policy from a tool's declared execution cost: cheap
 * tools get more automatic attempts, expensive ones (e.g. anything
 * costed `"high"`) get at most one, so a flaky expensive operation never
 * silently repeats itself several times.
 */
export class ToolRetryPlanner {
  planFor(spec: ToolSpec): ToolRetryPolicy {
    return {
      maxAttempts: COST_TO_RETRIES[spec.executionCost],
      backoffMs: 250,
      backoffMultiplier: 2,
    };
  }

  shouldRetry(result: ToolResult, policy: ToolRetryPolicy): boolean {
    return RETRYABLE_STATUSES.has(result.status) && result.attempts < policy.maxAttempts;
  }

  delayForAttempt(policy: ToolRetryPolicy, attempt: number): number {
    return policy.backoffMs * Math.pow(policy.backoffMultiplier, Math.max(0, attempt - 1));
  }
}

export function createToolRetryPlanner(): ToolRetryPlanner {
  return new ToolRetryPlanner();
}

export interface ToolRecoveryStep {
  readonly description: string;
  readonly suggestion: string;
}

/**
 * Produces a human-readable degradation message for a tool call that
 * ultimately failed — the equivalent, at the tool layer, of
 * `@ryper/planner`'s `RecoveryPlanner` graceful-alternative messages.
 * This package has no channel to actually roll back a partially-completed
 * side effect; that responsibility belongs to whichever platform adapter
 * owns the resource the tool touched.
 */
export class ToolRecoveryPlanner {
  planFor(spec: ToolSpec, result: ToolResult): ToolRecoveryStep {
    switch (result.status) {
      case "permission_denied":
        return {
          description: `"${spec.name}" requires a permission that wasn't granted.`,
          suggestion: "Ask the user to grant the required capability and retry.",
        };
      case "timeout":
        return {
          description: `"${spec.name}" didn't finish within ${spec.timeoutMs}ms.`,
          suggestion:
            "Retry with backoff, or fall back to a lower-cost alternative tool if one exists.",
        };
      case "validation_error":
        return {
          description: `"${spec.name}" was called with parameters that don't match its input schema.`,
          suggestion: "Re-derive parameters (from the Planner's Context Resolver) before retrying.",
        };
      default:
        return {
          description: `"${spec.name}" failed: ${result.errorMessage ?? "unknown error"}.`,
          suggestion: "Surface a conversational fallback rather than silently dropping the step.",
        };
    }
  }
}

export function createToolRecoveryPlanner(): ToolRecoveryPlanner {
  return new ToolRecoveryPlanner();
}

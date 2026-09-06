import type { Capability } from "@ryper/security";

// ---- Task types ----

/**
 * Abstract task domains the planner understands. These are *interfaces
 * only* — the planner never performs the underlying action itself. A
 * future platform agent (Desktop, Android, iOS, Browser, Automation,
 * Documents, Vision, ...) executes a `TaskNode` by matching its
 * `taskType`/`operation` against its own handler table.
 */
export type TaskType =
  | "application"
  | "browser"
  | "document"
  | "image"
  | "video"
  | "audio"
  | "file"
  | "calendar"
  | "note"
  | "message"
  | "call"
  | "camera"
  | "smart_home"
  | "automation"
  | "ai"
  | "memory"
  | "plugin"
  | "cloud"
  | "platform";

export type SupportedPlatform = "windows" | "macos" | "linux" | "android" | "ios" | "web";

export type TaskPriority = "low" | "normal" | "high" | "critical";

/** A single edge condition gating whether a dependent task runs. */
export interface TaskCondition {
  /** Name of an upstream task whose result this condition inspects. */
  readonly dependsOnTaskId: string;
  /** Human-authored predicate description; evaluated by `evaluateCondition`. */
  readonly expression: string;
}

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMs: number;
  readonly backoffMultiplier: number;
}

export interface RecoveryStep {
  readonly description: string;
  /** A fallback task to run in place of the failed one, if any. */
  readonly fallbackTask?: TaskNode;
  /** Whether a successful recovery should let the graph continue past the failure. */
  readonly continueOnSuccess: boolean;
}

export type TaskExecutionState =
  "pending" | "blocked" | "ready" | "running" | "succeeded" | "failed" | "cancelled" | "skipped";

/**
 * One node of the execution DAG. This is an *execution contract*, not an
 * implementation — `operation` and `parameters` are the abstract request a
 * downstream platform agent must interpret.
 */
export interface TaskNode {
  readonly id: string;
  readonly taskType: TaskType;
  readonly operation: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly dependsOn: readonly string[];
  readonly condition?: TaskCondition;
  readonly requiredCapability?: Capability;
  readonly priority: TaskPriority;
  readonly deadlineMs?: number;
  readonly timeoutMs?: number;
  readonly retryPolicy?: RetryPolicy;
  readonly recovery?: RecoveryStep;
  readonly parallelGroup?: string;
}

export interface TaskRuntimeStatus {
  readonly taskId: string;
  readonly state: TaskExecutionState;
  readonly attempts: number;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly error?: string;
  readonly result?: unknown;
}

// ---- Intent understanding ----

export type IntentShape =
  "simple" | "multi_step" | "conditional" | "scheduled" | "parallel" | "recursive";

export interface ScheduleSpec {
  /** e.g. "daily", "weekdays", "weekly", "once" */
  readonly recurrence: "once" | "daily" | "weekdays" | "weekly";
  /** 24h "HH:MM" local time, when the phrase specifies a time. */
  readonly atTime?: string;
}

export interface ParsedIntent {
  readonly raw: string;
  readonly shape: IntentShape;
  /** Individual clauses split out of a multi-step / parallel request. */
  readonly clauses: readonly string[];
  readonly condition?: { readonly trigger: string; readonly action: string };
  readonly schedule?: ScheduleSpec;
  /** True when clauses are meant to run concurrently rather than in order. */
  readonly parallel: boolean;
  /** True for "repeat this workflow every weekday"-style recursive requests. */
  readonly recursive: boolean;
}

// ---- Goals ----

export interface Goal {
  readonly id: string;
  readonly description: string;
  readonly clause: string;
}

// ---- Execution plans ----

export interface ExecutionPlanMetadata {
  readonly createdAt: string;
  readonly sourceRequest: string;
  readonly platform: SupportedPlatform;
  readonly intentShape: IntentShape;
}

export interface ExecutionPlan {
  readonly id: string;
  readonly tasks: readonly TaskNode[];
  readonly executionLevels: readonly (readonly string[])[];
  readonly schedule?: ScheduleSpec;
  readonly metadata: ExecutionPlanMetadata;
  readonly diagnostics: readonly string[];
}

export interface PlanRequest {
  readonly text: string;
  readonly platform: SupportedPlatform;
  readonly actorId?: string;
  readonly sessionId?: string;
}

// ---- Capability resolution ----

export interface PlatformCapabilitySnapshot {
  readonly platform: SupportedPlatform;
  /** Task types the current platform agent is known to support. */
  readonly supportedTaskTypes: ReadonlySet<TaskType>;
}

export interface CapabilityResolution {
  readonly taskType: TaskType;
  readonly supported: boolean;
  readonly requiredCapability?: Capability;
  /** Set when `supported` is false — a graceful alternative rather than a hard failure. */
  readonly alternative?: string;
}

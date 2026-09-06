import type { Capability } from "@ryper/security";

// ---- Categories ----

/**
 * Categories are an *open* set — "future categories must be registerable
 * without modifying the framework" — so the type stays `string` at
 * runtime; these are the built-ins the brief lists, exported as constants
 * for convenience and type-checked call sites, not a closed union.
 */
export type ToolCategory = string;

export const BUILTIN_TOOL_CATEGORIES = [
  "application",
  "browser",
  "document",
  "pdf",
  "image",
  "video",
  "audio",
  "file",
  "clipboard",
  "calendar",
  "note",
  "message",
  "call",
  "camera",
  "photo",
  "storage",
  "network",
  "automation",
  "smart_home",
  "system",
  "plugin",
  "ai",
  "memory",
  "cloud",
] as const;

export type BuiltinToolCategory = (typeof BUILTIN_TOOL_CATEGORIES)[number];

// ---- JSON schema (minimal subset, validated by ToolValidator) ----

export type JsonSchemaType = "object" | "string" | "number" | "integer" | "boolean" | "array";

export interface JsonSchema {
  readonly type: JsonSchemaType;
  readonly description?: string;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly enum?: readonly unknown[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
}

// ---- Permissions ----

export interface ToolPermissionRequirement {
  readonly capability: Capability;
  /** A one-shot or session-scoped grant is auto-revoked; omit for a permanent (until explicitly revoked) grant. */
  readonly temporary?: boolean;
  readonly ttlMs?: number;
}

// ---- Tool model ----

export type ExecutionCost = "free" | "low" | "medium" | "high";

export interface ToolExample {
  readonly description: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly output?: unknown;
}

export interface ToolErrorCode {
  readonly code: string;
  readonly description: string;
}

/**
 * Every tool's advertised metadata — the brief's "every tool must expose"
 * list, verbatim. This is what `ToolDiscovery` searches and what a
 * platform adapter or the Planner's `ToolSelector` reads before deciding
 * to invoke.
 */
export interface ToolSpec {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: ToolCategory;
  readonly version: string;
  readonly author: string;
  readonly capabilities: readonly Capability[];
  readonly permissions: readonly ToolPermissionRequirement[];
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  readonly examples: readonly ToolExample[];
  readonly errorCodes: readonly ToolErrorCode[];
  readonly executionCost: ExecutionCost;
  readonly timeoutMs: number;
  readonly cancellationSupport: boolean;
  readonly streamingSupport: boolean;
}

// ---- Execution context ----

export type ToolPlatform = "windows" | "macos" | "linux" | "android" | "ios" | "web";

export interface ToolExecutionContext {
  readonly invocationId: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly platform: ToolPlatform;
  readonly signal?: AbortSignal;
}

// ---- Invocation & results ----

export interface ToolInvocationRequest {
  readonly toolId: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly actorId: string;
  readonly sessionId: string;
  readonly platform: ToolPlatform;
  readonly priority?: "low" | "normal" | "high" | "critical";
  readonly timeoutMs?: number;
}

export type ToolResultStatus =
  "ok" | "validation_error" | "permission_denied" | "error" | "timeout" | "cancelled";

export interface ToolResult {
  readonly invocationId: string;
  readonly toolId: string;
  readonly status: ToolResultStatus;
  readonly value?: unknown;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly attempts: number;
}

// ---- Streaming ----

export interface ToolStreamChunk {
  readonly invocationId: string;
  readonly sequence: number;
  readonly data: unknown;
  readonly done: boolean;
}

/** A streaming tool yields chunks as they become available; the last one has `done: true`. */
export type ToolStreamExecutor = (
  parameters: Readonly<Record<string, unknown>>,
  context: ToolExecutionContext,
) => AsyncIterable<unknown>;

export type ToolExecuteFn = (
  parameters: Readonly<Record<string, unknown>>,
  context: ToolExecutionContext,
) => Promise<unknown> | unknown;

/**
 * The full contract a tool implements. `execute` is required; `executeStream`
 * is only present (and only called) when `spec.streamingSupport` is true.
 */
export interface ToolDefinition {
  readonly spec: ToolSpec;
  readonly execute: ToolExecuteFn;
  readonly executeStream?: ToolStreamExecutor;
}

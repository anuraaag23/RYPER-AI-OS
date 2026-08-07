import type { ToolExecutionContext, ToolInvocationRequest, ToolPlatform } from "./types.js";

let counter = 0;
export function nextInvocationId(): string {
  counter += 1;
  return `invocation-${counter}-${Date.now().toString(36)}`;
}

/**
 * Builds the immutable `ToolExecutionContext` passed to a tool's
 * `execute`/`executeStream`. Centralized so every caller — the direct
 * `ToolManager.invoke()` path, the Planner bridge, the voice bridge —
 * produces contexts with the same shape and a fresh, traceable
 * `invocationId`.
 */
export function buildToolContext(
  request: ToolInvocationRequest,
  signal?: AbortSignal,
  invocationId: string = nextInvocationId(),
): ToolExecutionContext {
  return {
    invocationId,
    actorId: request.actorId,
    sessionId: request.sessionId,
    platform: request.platform,
    ...(signal ? { signal } : {}),
  };
}

export function isKnownPlatform(value: string): value is ToolPlatform {
  return ["windows", "macos", "linux", "android", "ios", "web"].includes(value);
}

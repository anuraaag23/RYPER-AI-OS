import type { ToolDefinition, ToolSpec } from "@ryper/tool-framework";
import type { CapabilityManager } from "./capability-manager.js";
import type { CapabilityDomain } from "./types.js";

/**
 * The brief's Tool Framework Integration requirement — "the Tool Calling
 * Framework must invoke capabilities only through the Platform Capability
 * Layer; no tool may directly depend on platform-specific APIs" — made
 * concrete: this wraps one `(domain, operation)` pair as a real
 * `ToolDefinition` whose `execute` calls `CapabilityManager.invoke()`
 * exclusively. A future platform-touching tool should be built with this
 * factory rather than a hand-rolled `execute` that reaches for an OS API
 * itself.
 */
export function createCapabilityTool(
  manager: CapabilityManager,
  domain: CapabilityDomain,
  operation: string,
  spec: ToolSpec,
): ToolDefinition {
  return {
    spec,
    execute: (parameters, context) => manager.invoke(domain, operation, parameters, context),
  };
}

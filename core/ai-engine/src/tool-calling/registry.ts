import type { CapabilityBroker } from "@ryper/security";
import { createLogger } from "@ryper/logging";
import type { ToolCallRequest, ToolSpec } from "../types.js";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "./types.js";
import { buildToolResult } from "./types.js";
import { describeInvalidToolCall, validateToolArguments } from "./validation.js";

const log = createLogger("ai-engine:tool-calling");

/**
 * Registers tool definitions and executes tool calls the model requests.
 * Every invocation re-checks the capability broker (mirroring
 * `@ryper/plugin-runtime`'s pattern) rather than trusting that a tool being
 * registered implies it's allowed to run.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(private readonly broker?: CapabilityBroker) {}

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.spec.name)) {
      throw new Error(`tool "${tool.spec.name}" is already registered`);
    }
    this.tools.set(tool.spec.name, tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Specs for every registered tool, in the shape providers expect to advertise to the model. */
  listSpecs(): readonly ToolSpec[] {
    return [...this.tools.values()].map((t) => t.spec);
  }

  async invoke(
    request: ToolCallRequest,
    context: ToolExecutionContext,
    actorId = "ai-engine",
  ): Promise<ToolResult> {
    const tool = this.tools.get(request.name);
    if (!tool) {
      return buildToolResult(request.id, false, { error: `unknown tool "${request.name}"` });
    }

    // Never trust LLM-generated arguments: validated against the tool's
    // own advertised schema before capability checks or execution, so an
    // out-of-range/malformed/hallucinated argument (e.g. `set_volume(500)`)
    // is rejected here, structurally, not left to each tool's own
    // discretion.
    const validation = validateToolArguments(tool.spec.parameters, request.arguments);
    if (!validation.ok) {
      log.warn("tool call blocked: invalid arguments", {
        tool: request.name,
        errors: validation.errors,
      });
      return buildToolResult(request.id, false, {
        error: describeInvalidToolCall(request, validation),
      });
    }

    if (tool.requiredCapability && this.broker) {
      try {
        this.broker.assertGranted(actorId, tool.requiredCapability);
      } catch (err) {
        log.warn("tool call blocked: capability not granted", {
          tool: request.name,
          capability: tool.requiredCapability,
        });
        return buildToolResult(request.id, false, { error: String(err) });
      }
    }

    // Real gap found and fixed during the Tier 1 lifecycle-hardening
    // pass (see docs/adr/0031, PART 15): `context.signal` was already
    // threaded all the way from `AIOrchestrator.sendMessage()`'s own
    // caller down to here, but nothing ever actually checked it before
    // calling `execute()`. A turn cancelled *after* the LLM decided to
    // call a tool but *before* that tool actually ran would still
    // execute it in full — for a destructive/system-impacting tool
    // (shutdown, delete_file, a power action), that's a real user-
    // visible correctness problem, not just a cosmetic one: the user
    // cancelled, and the action happened anyway. Checked here, once,
    // structurally — not left to each individual tool's own `execute()`
    // to remember to check.
    if (context.signal?.aborted) {
      log.info("tool call skipped: turn was cancelled before execution", { tool: request.name });
      return buildToolResult(request.id, false, { error: "cancelled" });
    }

    try {
      const value = await tool.execute(request.arguments, context);
      return buildToolResult(request.id, true, value);
    } catch (err) {
      log.error("tool execution threw", { tool: request.name, error: String(err) });
      return buildToolResult(request.id, false, { error: String(err) });
    }
  }
}

export function createToolRegistry(broker?: CapabilityBroker): ToolRegistry {
  return new ToolRegistry(broker);
}

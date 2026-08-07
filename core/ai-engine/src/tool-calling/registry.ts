import type { CapabilityBroker } from "@ryper/security";
import { createLogger } from "@ryper/logging";
import type { ToolCallRequest, ToolSpec } from "../types.js";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "./types.js";
import { buildToolResult } from "./types.js";

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

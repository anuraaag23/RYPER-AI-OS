import { createLogger } from "@ryper/logging";
import type { Capability } from "@ryper/security";
import type { ToolCategory, ToolDefinition, ToolSpec } from "./types.js";

const log = createLogger("tool-framework:registry");

export class ToolRegistrationError extends Error {}

/**
 * Owns the live set of registered tools. Registration/unregistration is
 * the only way a tool's spec becomes visible to `ToolDiscovery`,
 * `ToolManager`, or a plugin's dynamically-registered schema — nothing in
 * this package hardcodes a tool list.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.spec.id)) {
      throw new ToolRegistrationError(`tool "${tool.spec.id}" is already registered`);
    }
    this.tools.set(tool.spec.id, tool);
    log.info("tool registered", {
      id: tool.spec.id,
      category: tool.spec.category,
      version: tool.spec.version,
    });
  }

  /** Replaces an existing tool's definition in place — used for plugin tool updates/versioning. */
  update(tool: ToolDefinition): void {
    if (!this.tools.has(tool.spec.id)) {
      throw new ToolRegistrationError(`cannot update unregistered tool "${tool.spec.id}"`);
    }
    this.tools.set(tool.spec.id, tool);
    log.info("tool updated", { id: tool.spec.id, version: tool.spec.version });
  }

  unregister(toolId: string): boolean {
    const removed = this.tools.delete(toolId);
    if (removed) log.info("tool unregistered", { id: toolId });
    return removed;
  }

  has(toolId: string): boolean {
    return this.tools.has(toolId);
  }

  get(toolId: string): ToolDefinition | undefined {
    return this.tools.get(toolId);
  }

  list(): readonly ToolDefinition[] {
    return [...this.tools.values()];
  }

  listSpecs(): readonly ToolSpec[] {
    return this.list().map((tool) => tool.spec);
  }
}

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}

export interface ToolQuery {
  readonly category?: ToolCategory;
  readonly capability?: Capability;
  readonly keyword?: string;
  readonly streamingOnly?: boolean;
}

/**
 * Search over a `ToolRegistry`'s current contents. Kept as a separate
 * class (rather than methods on the registry) so discovery logic can grow
 * — ranking, fuzzy matching, plugin-sourced facets — without touching
 * registration/execution concerns.
 */
export class ToolDiscovery {
  constructor(private readonly registry: ToolRegistry) {}

  find(query: ToolQuery): readonly ToolSpec[] {
    return this.registry
      .listSpecs()
      .filter((spec) => (query.category ? spec.category === query.category : true))
      .filter((spec) => (query.capability ? spec.capabilities.includes(query.capability) : true))
      .filter((spec) => (query.streamingOnly ? spec.streamingSupport : true))
      .filter((spec) => (query.keyword ? matchesKeyword(spec, query.keyword) : true));
  }

  categories(): readonly ToolCategory[] {
    return [...new Set(this.registry.listSpecs().map((spec) => spec.category))].sort();
  }
}

function matchesKeyword(spec: ToolSpec, keyword: string): boolean {
  const haystack = `${spec.name} ${spec.description} ${spec.id}`.toLowerCase();
  return haystack.includes(keyword.toLowerCase());
}

export function createToolDiscovery(registry: ToolRegistry): ToolDiscovery {
  return new ToolDiscovery(registry);
}

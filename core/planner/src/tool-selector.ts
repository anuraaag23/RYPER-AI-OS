import type { PlannerPluginRegistry } from "./plugin-registry.js";
import type { TaskNode } from "./types.js";

export type ToolRoute =
  | { readonly kind: "platform_agent"; readonly agent: string }
  | { readonly kind: "plugin"; readonly pluginId: string; readonly operation: string }
  | { readonly kind: "unresolved"; readonly reason: string };

/** Maps abstract task types to the future platform-agent package that owns them. */
const AGENT_BY_TASK_TYPE: Readonly<Record<string, string>> = {
  application: "desktop-agent",
  browser: "browser-agent",
  document: "documents-agent",
  image: "media-agent",
  video: "media-agent",
  audio: "media-agent",
  file: "desktop-agent",
  calendar: "desktop-agent",
  note: "desktop-agent",
  message: "desktop-agent",
  call: "mobile-agent",
  camera: "mobile-agent",
  smart_home: "automation-agent",
  automation: "automation-agent",
  ai: "ai-engine",
  memory: "memory-system",
  cloud: "cloud-agent",
  platform: "platform-agent",
};

/**
 * Chooses which future executor a `TaskNode` will be handed to. The
 * planner never calls the executor itself — this is purely a routing
 * decision recorded on the plan so a downstream agent (or diagnostics
 * tooling) can see why a task was shaped the way it was.
 */
export class ToolSelector {
  constructor(private readonly plugins?: PlannerPluginRegistry) {}

  select(task: TaskNode): ToolRoute {
    if (task.taskType === "plugin") {
      const schema = this.plugins?.find(task.operation);
      if (!schema) {
        return {
          kind: "unresolved",
          reason: `no plugin task schema registered for operation "${task.operation}"`,
        };
      }
      return { kind: "plugin", pluginId: schema.pluginId, operation: schema.operation };
    }
    const agent = AGENT_BY_TASK_TYPE[task.taskType];
    if (!agent) {
      return {
        kind: "unresolved",
        reason: `no platform agent mapped for task type "${task.taskType}"`,
      };
    }
    return { kind: "platform_agent", agent };
  }
}

export function createToolSelector(plugins?: PlannerPluginRegistry): ToolSelector {
  return new ToolSelector(plugins);
}

import type { MemoryManager } from "@ryper/memory-system";
import type { TaskNode } from "./types.js";

/** Parameter keys, per operation, that a memory-backed preference can fill in when missing. */
const DEFAULTABLE_PARAMETERS: Readonly<Record<string, string>> = {
  "browser.search": "site",
  "browser.navigate": "url",
  "audio.set_volume": "level",
};

/**
 * Reads the single most relevant `preference`-typed memory tagged
 * `pref:<key>` and returns its content, or `undefined` if none exists.
 * Preferences are written with `rememberPreference` below, keeping the
 * tagging convention in one place.
 */
export async function getPreference(
  memory: MemoryManager,
  key: string,
): Promise<string | undefined> {
  const matches = memory.filterMemories({ type: "preference", tag: `pref:${key}` });
  const [best] = [...matches].sort(
    (a, b) => b.importance - a.importance || b.updatedAt.localeCompare(a.updatedAt),
  );
  return best?.content;
}

export async function rememberPreference(
  memory: MemoryManager,
  key: string,
  value: string,
  actor = "planner",
): Promise<void> {
  await memory.createMemoryAuto(
    value,
    { type: "preference", tags: [`pref:${key}`], metadata: { source: "agent-planner" } },
    actor,
  );
}

/** `{{taskId.field}}` reference inside a string parameter value. */
const REFERENCE_PATTERN = /^\{\{(?<taskId>[\w-]+)\.(?<field>[\w.]+)\}\}$/;

function readField(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, value);
}

/**
 * Resolves two kinds of context a task's parameters may need before it
 * can run: (a) user preferences pulled from `@ryper/memory-system`, used
 * to fill parameters the Task Generator left blank, and (b) upstream task
 * results referenced with `{{taskId.field}}`, resolved once those tasks
 * have actually produced a result during execution.
 */
export class ContextResolver {
  constructor(private readonly memory?: MemoryManager) {}

  /** Plan-time pass: fill missing defaultable parameters from remembered preferences. */
  async applyMemoryDefaults(tasks: readonly TaskNode[]): Promise<readonly TaskNode[]> {
    if (!this.memory) return tasks;
    const resolved: TaskNode[] = [];
    for (const task of tasks) {
      const key = `${task.taskType}.${task.operation}`;
      const paramName = DEFAULTABLE_PARAMETERS[key];
      if (!paramName || task.parameters[paramName] !== undefined) {
        resolved.push(task);
        continue;
      }
      const preference = await getPreference(this.memory, key);
      resolved.push(
        preference === undefined
          ? task
          : { ...task, parameters: { ...task.parameters, [paramName]: preference } },
      );
    }
    return resolved;
  }

  /** Execution-time pass: substitute `{{taskId.field}}` references using completed results. */
  resolveRuntimeReferences(task: TaskNode, results: ReadonlyMap<string, unknown>): TaskNode {
    const parameters: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(task.parameters)) {
      if (typeof value !== "string") {
        parameters[key] = value;
        continue;
      }
      const match = REFERENCE_PATTERN.exec(value);
      if (!match?.groups) {
        parameters[key] = value;
        continue;
      }
      const upstream = results.get(match.groups["taskId"]!);
      parameters[key] = readField(upstream, match.groups["field"]!) ?? value;
    }
    return { ...task, parameters };
  }
}

export function createContextResolver(memory?: MemoryManager): ContextResolver {
  return new ContextResolver(memory);
}

import { taskTypeToCapability } from "./capability.js";
import type { Goal, TaskNode, TaskPriority, TaskType } from "./types.js";

interface ClausePattern {
  readonly taskType: TaskType;
  readonly operation: string;
  readonly pattern: RegExp;
  readonly paramNames?: readonly string[];
}

/** Deterministic clause -> abstract task classification, in priority order. */
const patterns: readonly ClausePattern[] = [
  {
    taskType: "application",
    operation: "open",
    pattern: /^open (?<app>(?!.*\.\w{2,4}$).+)$/i,
    paramNames: ["app"],
  },
  {
    taskType: "browser",
    operation: "navigate",
    pattern: /^(?:open|go to) (?:website )?(?<url>[\w.-]+\.\w+.*)$/i,
    paramNames: ["url"],
  },
  {
    taskType: "browser",
    operation: "search",
    pattern: /^search (?:for )?(?<query>.+?)(?: on (?<site>youtube|google|the web))?$/i,
    paramNames: ["query", "site"],
  },
  {
    taskType: "browser",
    operation: "play_first_result",
    pattern: /^play (?:the )?first result$/i,
  },
  {
    taskType: "audio",
    operation: "set_volume",
    pattern: /^(?:lower|raise|increase|decrease|set|mute) (?:the )?volume(?: to (?<level>\d+))?$/i,
    paramNames: ["level"],
  },
  {
    taskType: "document",
    operation: "summarize",
    pattern: /^summari[sz]e (?:this|the) (?:pdf|document|doc)(?: (?<target>.+))?$/i,
    paramNames: ["target"],
  },
  {
    taskType: "document",
    operation: "edit",
    pattern: /^edit (?:the )?(?:pdf|document|doc)(?: (?<target>.+))?$/i,
    paramNames: ["target"],
  },
  {
    taskType: "image",
    operation: "edit",
    pattern: /^edit (?:the )?(?:image|photo)(?: (?<target>.+))?$/i,
    paramNames: ["target"],
  },
  {
    taskType: "file",
    operation: "download",
    pattern: /^download(?: (?<target>.+))?$/i,
    paramNames: ["target"],
  },
  {
    taskType: "calendar",
    operation: "read",
    pattern: /^read (?:my )?calendar$/i,
  },
  {
    taskType: "note",
    operation: "create",
    pattern: /^(?:create|take|make) a note(?: that says)? (?<content>.+)$/i,
    paramNames: ["content"],
  },
  {
    taskType: "call",
    operation: "place_call",
    pattern: /^call (?<contact>.+)$/i,
    paramNames: ["contact"],
  },
  {
    taskType: "message",
    operation: "notify",
    pattern: /^notify me(?: (?:that|about) (?<content>.+))?$/i,
    paramNames: ["content"],
  },
  {
    taskType: "smart_home",
    operation: "set_device_state",
    pattern: /^turn (?<state>on|off) (?:the )?(?<device>.+)$/i,
    paramNames: ["state", "device"],
  },
  {
    taskType: "automation",
    operation: "run",
    pattern: /^run (?:automation )?(?<name>.+)$/i,
    paramNames: ["name"],
  },
  {
    taskType: "cloud",
    operation: "sync",
    pattern: /^sync (?<target>.+)$/i,
    paramNames: ["target"],
  },
  {
    taskType: "memory",
    operation: "recall",
    pattern: /^(?:remember|recall) (?<content>.+)$/i,
    paramNames: ["content"],
  },
];

function classify(clause: string): {
  taskType: TaskType;
  operation: string;
  parameters: Record<string, unknown>;
} {
  const trimmed = clause.trim().replace(/[.!]+$/, "");
  for (const candidate of patterns) {
    const match = candidate.pattern.exec(trimmed);
    if (!match) continue;
    const parameters: Record<string, unknown> = {};
    for (const name of candidate.paramNames ?? []) {
      const value = match.groups?.[name];
      if (value) parameters[name] = value.trim();
    }
    return { taskType: candidate.taskType, operation: candidate.operation, parameters };
  }
  // No deterministic pattern matched: fall through to a conversational AI
  // task rather than failing the whole plan on one unclassifiable clause.
  return { taskType: "ai", operation: "respond", parameters: { prompt: trimmed } };
}

let counter = 0;
function nextTaskId(taskType: TaskType): string {
  counter += 1;
  return `task-${taskType}-${counter}`;
}

export interface TaskGenerationOptions {
  readonly sequential: boolean;
  readonly priority?: TaskPriority;
}

/**
 * Converts each `Goal` into an abstract `TaskNode`. When `sequential` is
 * true (the default for multi-step requests), each generated task depends
 * on the one before it; parallel requests instead leave `dependsOn` empty
 * so the Dependency Analyzer places them in the same execution level.
 */
export class TaskGenerator {
  generate(goals: readonly Goal[], options: TaskGenerationOptions): readonly TaskNode[] {
    const tasks: TaskNode[] = [];
    let previousId: string | undefined;
    for (const goal of goals) {
      const { taskType, operation, parameters } = classify(goal.clause);
      const id = nextTaskId(taskType);
      const dependsOn = options.sequential && previousId ? [previousId] : [];
      const requiredCapability = taskTypeToCapability[taskType];
      tasks.push({
        id,
        taskType,
        operation,
        description: goal.description,
        parameters,
        dependsOn,
        priority: options.priority ?? "normal",
        ...(requiredCapability ? { requiredCapability } : {}),
      });
      previousId = id;
    }
    return tasks;
  }
}

export function createTaskGenerator(): TaskGenerator {
  return new TaskGenerator();
}

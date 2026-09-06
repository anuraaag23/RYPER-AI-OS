import { describe, expect, it } from "vitest";
import { GoalAnalyzer } from "../src/goal-analyzer.js";
import { TaskGenerator } from "../src/task-generator.js";
import { IntentParser } from "../src/intent-parser.js";

describe("GoalAnalyzer", () => {
  it("turns each clause into a distinct goal", () => {
    const goals = new GoalAnalyzer().analyze({
      raw: "a. b.",
      shape: "multi_step",
      clauses: ["open calculator", "lower the volume"],
      parallel: false,
      recursive: false,
    });
    expect(goals).toHaveLength(2);
    expect(goals[0]?.clause).toBe("open calculator");
    expect(goals[0]?.description).toBe("Open calculator");
    expect(goals[0]?.id).not.toBe(goals[1]?.id);
  });
});

describe("TaskGenerator", () => {
  const parser = new IntentParser();
  const goalAnalyzer = new GoalAnalyzer();
  const generator = new TaskGenerator();

  function generateFor(text: string, sequential = true) {
    const intent = parser.parse(text);
    const goals = goalAnalyzer.analyze(intent);
    return generator.generate(goals, { sequential });
  }

  it("classifies a simple 'open <app>' command", () => {
    const tasks = generateFor("Open Calculator.");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.taskType).toBe("application");
    expect(tasks[0]?.operation).toBe("open");
    expect(tasks[0]?.parameters["app"]).toBe("Calculator");
  });

  it("classifies a multi-step workflow and chains dependencies sequentially", () => {
    const tasks = generateFor(
      "Open YouTube, search for Interstellar soundtrack, play the first result, then lower the volume.",
    );
    expect(tasks).toHaveLength(4);
    expect(tasks[0]?.taskType).toBe("application");
    expect(tasks[1]?.taskType).toBe("browser");
    expect(tasks[1]?.operation).toBe("search");
    expect(tasks[1]?.parameters["query"]).toContain("Interstellar");
    expect(tasks[2]?.operation).toBe("play_first_result");
    expect(tasks[3]?.taskType).toBe("audio");
    // sequential chaining: each task depends on the previous one
    expect(tasks[1]?.dependsOn).toEqual([tasks[0]?.id]);
    expect(tasks[2]?.dependsOn).toEqual([tasks[1]?.id]);
    expect(tasks[3]?.dependsOn).toEqual([tasks[2]?.id]);
  });

  it("leaves tasks independent when generation is not sequential", () => {
    const tasks = generateFor("Summarize this PDF while downloading today's emails.", false);
    expect(tasks.every((task) => task.dependsOn.length === 0)).toBe(true);
  });

  it("falls back to a conversational AI task for an unclassifiable clause", () => {
    const tasks = generateFor("tell me something interesting");
    expect(tasks[0]?.taskType).toBe("ai");
    expect(tasks[0]?.operation).toBe("respond");
  });

  it("assigns the mapped capability for a capability-gated task type", () => {
    const tasks = generateFor("turn on the kitchen lights");
    expect(tasks[0]?.taskType).toBe("smart_home");
    // smart_home has no entry in taskTypeToCapability today; automation does.
    const automationTasks = generateFor("run backup automation");
    expect(automationTasks[0]?.requiredCapability).toBe("automation.execute");
  });
});

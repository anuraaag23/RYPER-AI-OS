import { describe, expect, it } from "vitest";
import {
  ConversationalPlanningSession,
  createPlannerVoiceCommandHandler,
  youtubeStudyPlaylistRule,
} from "../src/voice-integration.js";
import type { ExecutionPlan, TaskNode } from "../src/types.js";

function openYoutubeTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "task-application-1",
    taskType: "application",
    operation: "open",
    description: "Open YouTube",
    parameters: { app: "YouTube" },
    dependsOn: [],
    priority: "normal",
    ...overrides,
  };
}

function plan(tasks: readonly TaskNode[]): ExecutionPlan {
  return {
    id: "plan-1",
    tasks,
    executionLevels: [tasks.map((t) => t.id)],
    metadata: {
      createdAt: new Date().toISOString(),
      sourceRequest: "open youtube",
      platform: "windows",
      intentShape: "simple",
    },
    diagnostics: [],
  };
}

describe("ConversationalPlanningSession", () => {
  const session = new ConversationalPlanningSession();

  it("finds no clarification needed for a plan with no ambiguous tasks", () => {
    const p = plan([{ ...openYoutubeTask(), parameters: { app: "Calculator" } }]);
    expect(session.findClarification(p)).toBeUndefined();
  });

  it("surfaces the study-playlist question for an 'open YouTube' task", () => {
    const p = plan([openYoutubeTask()]);
    const pending = session.findClarification(p);
    expect(pending?.question.text).toBe("Do you want your usual study playlist?");
    expect(pending?.question.rule).toBe(youtubeStudyPlaylistRule);
  });

  it("patches the plan in place with the resolved answer, without changing the plan id", () => {
    const p = plan([openYoutubeTask()]);
    const pending = session.findClarification(p);
    expect(pending).toBeDefined();
    const updated = session.applyAnswer(pending!, "Yes please");
    expect(updated.id).toBe(p.id);
    expect(updated.tasks[0]?.parameters["playlist"]).toBe("study playlist");
  });

  it("leaves parameters unchanged when the answer doesn't resolve to a value", () => {
    const p = plan([openYoutubeTask()]);
    const pending = session.findClarification(p);
    const updated = session.applyAnswer(pending!, "no thanks");
    expect(updated.tasks[0]?.parameters["playlist"]).toBeUndefined();
  });
});

describe("createPlannerVoiceCommandHandler", () => {
  it("asks the clarifying question when the built plan is ambiguous", async () => {
    const service = { plan: async () => plan([openYoutubeTask()]) };
    const handler = createPlannerVoiceCommandHandler(
      service,
      new ConversationalPlanningSession(),
      "windows",
    );
    const result = await handler.handle(
      { intent: "plan_request", slots: { goal: "open youtube" }, confidence: 1 },
      { sessionId: "s1" },
    );
    expect(result.handled).toBe(true);
    expect(result.spokenResponse).toBe("Do you want your usual study playlist?");
  });

  it("confirms the plan was built when there is nothing to clarify", async () => {
    const service = {
      plan: async () => plan([{ ...openYoutubeTask(), parameters: { app: "Calculator" } }]),
    };
    const handler = createPlannerVoiceCommandHandler(
      service,
      new ConversationalPlanningSession(),
      "windows",
    );
    const result = await handler.handle(
      { intent: "plan_request", slots: { goal: "open calculator" }, confidence: 1 },
      { sessionId: "s1" },
    );
    expect(result.spokenResponse).toContain("1-step plan");
  });

  it("responds gracefully when no request text was captured", async () => {
    const service = { plan: async () => plan([]) };
    const handler = createPlannerVoiceCommandHandler(
      service,
      new ConversationalPlanningSession(),
      "windows",
    );
    const result = await handler.handle(
      { intent: "plan_request", slots: {}, confidence: 1 },
      { sessionId: "s1" },
    );
    expect(result.spokenResponse).toContain("didn't catch");
  });
});

import type {
  VoiceCommandContext,
  VoiceCommandHandler,
  VoiceCommandMatch,
  VoiceCommandResult,
} from "@ryper/voice-engine";
import type { ExecutionPlan, SupportedPlatform, TaskNode } from "./types.js";

export interface ClarificationRule {
  readonly id: string;
  readonly parameterName: string;
  matchesTask(task: TaskNode): boolean;
  question(task: TaskNode): string;
  /** Returns the resolved parameter value, or `undefined` if the answer didn't resolve anything usable. */
  deriveValue(answer: string): string | undefined;
}

/** "Open YouTube" -> "Do you want your usual study playlist?" — the brief's worked example, as a real rule. */
export const youtubeStudyPlaylistRule: ClarificationRule = {
  id: "youtube-study-playlist",
  parameterName: "playlist",
  matchesTask: (task) =>
    task.taskType === "application" &&
    task.operation === "open" &&
    typeof task.parameters["app"] === "string" &&
    task.parameters["app"].toLowerCase().includes("youtube") &&
    task.parameters["playlist"] === undefined,
  question: () => "Do you want your usual study playlist?",
  deriveValue: (answer) =>
    /^\s*(yes|yeah|yep|sure|please)\b/i.test(answer) ? "study playlist" : undefined,
};

export interface ClarificationQuestion {
  readonly taskId: string;
  readonly rule: ClarificationRule;
  readonly text: string;
}

export interface PendingClarification {
  readonly plan: ExecutionPlan;
  readonly question: ClarificationQuestion;
}

/**
 * Drives the "planner asks a follow-up question, user answers, plan
 * updates in place" loop from the brief's voice-integration example. A
 * plan is patched (one task's parameters updated) rather than rebuilt
 * from scratch, so the conversation never has to restart.
 */
export class ConversationalPlanningSession {
  constructor(private readonly rules: readonly ClarificationRule[] = [youtubeStudyPlaylistRule]) {}

  /** Finds the first task in a fresh plan that still needs a clarifying question, if any. */
  findClarification(plan: ExecutionPlan): PendingClarification | undefined {
    for (const task of plan.tasks) {
      const rule = this.rules.find((candidate) => candidate.matchesTask(task));
      if (rule) {
        return { plan, question: { taskId: task.id, rule, text: rule.question(task) } };
      }
    }
    return undefined;
  }

  /** Applies the user's answer to the pending plan, returning the patched plan (same `id`). */
  applyAnswer(pending: PendingClarification, answerText: string): ExecutionPlan {
    const value = pending.question.rule.deriveValue(answerText);
    const tasks = pending.plan.tasks.map((task) =>
      task.id === pending.question.taskId && value !== undefined
        ? {
            ...task,
            parameters: { ...task.parameters, [pending.question.rule.parameterName]: value },
          }
        : task,
    );
    return { ...pending.plan, tasks };
  }
}

export function createConversationalPlanningSession(
  rules?: readonly ClarificationRule[],
): ConversationalPlanningSession {
  return new ConversationalPlanningSession(rules);
}

/** What the Planner Engine needs to expose for the voice command handler below to drive it. */
export interface PlanningService {
  plan(text: string, platform: SupportedPlatform): Promise<ExecutionPlan>;
}

/**
 * A `VoiceCommandHandler` (the real `@ryper/voice-engine` interface) that
 * routes a matched "plan_request" intent into the Planner Engine and
 * speaks back either a clarifying question or a plan-built confirmation.
 * Register it with `VoiceCommandRouter.register(...)` from a platform
 * shell once one exists — the interface is real and callable today.
 */
export function createPlannerVoiceCommandHandler(
  service: PlanningService,
  session: ConversationalPlanningSession,
  platform: SupportedPlatform,
  intent = "plan_request",
): VoiceCommandHandler {
  return {
    intent,
    async handle(
      match: VoiceCommandMatch,
      _context: VoiceCommandContext,
    ): Promise<VoiceCommandResult> {
      const requestText = match.slots["goal"] ?? match.slots["content"] ?? "";
      if (!requestText) {
        return { handled: true, spokenResponse: "I didn't catch what you'd like me to do." };
      }
      const plan = await service.plan(requestText, platform);
      const clarification = session.findClarification(plan);
      if (clarification) {
        return { handled: true, spokenResponse: clarification.question.text };
      }
      return {
        handled: true,
        spokenResponse: `Got it — I've put together a ${plan.tasks.length}-step plan for that.`,
      };
    },
  };
}

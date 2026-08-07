import type { Goal, ParsedIntent } from "./types.js";

let counter = 0;
function nextGoalId(): string {
  counter += 1;
  return `goal-${counter}-${Date.now().toString(36)}`;
}

/**
 * Turns a `ParsedIntent`'s clauses into ordered `Goal`s. One clause maps to
 * one goal today; this is the seam a smarter LLM-backed decomposition
 * (splitting a single dense clause into several sub-goals) plugs into
 * later without changing any downstream module's contract.
 */
export class GoalAnalyzer {
  analyze(intent: ParsedIntent): readonly Goal[] {
    if (intent.clauses.length === 0) {
      return [{ id: nextGoalId(), description: intent.raw, clause: intent.raw }];
    }
    return intent.clauses.map((clause) => ({
      id: nextGoalId(),
      description: describeClause(clause),
      clause,
    }));
  }
}

function describeClause(clause: string): string {
  const trimmed = clause.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function createGoalAnalyzer(): GoalAnalyzer {
  return new GoalAnalyzer();
}

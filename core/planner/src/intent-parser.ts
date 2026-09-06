import type { ParsedIntent, ScheduleSpec } from "./types.js";

export type IntentParserFn = (text: string) => ParsedIntent | undefined;

const CONDITIONAL_PREFIX = /^if\s+(?<rest>.+)$/i;

function parseConditional(raw: string): { trigger: string; action: string } | undefined {
  const match = CONDITIONAL_PREFIX.exec(raw);
  const rest = match?.groups?.["rest"];
  if (!rest) return undefined;

  const commaIndex = rest.indexOf(",");
  const thenMatch = /\bthen\b/i.exec(rest);
  const splitIndex = commaIndex !== -1 ? commaIndex : (thenMatch?.index ?? -1);
  if (splitIndex === -1) return undefined;

  const trigger = rest.slice(0, splitIndex).trim();
  const action = rest
    .slice(splitIndex + 1)
    .replace(/^,?\s*then\s+/i, "")
    .replace(/^,\s*/, "")
    .trim();
  if (!trigger || !action) return undefined;
  return { trigger, action };
}

const RECURRENCE_WORDS: Record<string, ScheduleSpec["recurrence"]> = {
  "every day": "daily",
  daily: "daily",
  "every morning": "daily",
  "every evening": "daily",
  "every weekday": "weekdays",
  weekdays: "weekdays",
  "every week": "weekly",
  weekly: "weekly",
};

const SCHEDULE_PATTERN =
  /\b(every day|daily|every morning|every evening|every weekday|weekdays|every week|weekly)\b(?:\s+at\s+(?<time>\d{1,2}(?::\d{2})?\s?(?:am|pm)?))?/i;

const RECURSIVE_PATTERN = /^repeat\s+(?:this\s+)?(?:workflow|task|it)\s+(.+)$/i;

/** Splits a request into clauses on top-level " then "/", " and "/"while " connectors. */
function splitClauses(text: string): { clauses: string[]; parallel: boolean } {
  const whileMatch = /^(.+?)\s+while\s+(.+)$/i.exec(text);
  if (whileMatch?.[1] && whileMatch[2]) {
    return { clauses: [whileMatch[1].trim(), whileMatch[2].trim()], parallel: true };
  }
  const clauses = text
    .split(/(?:,?\s+then\s+)|(?:,\s+)|(?:\s+and\s+then\s+)/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
  return { clauses, parallel: false };
}

function parseTimeToken(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const match = /^(\d{1,2})(?::(\d{2}))?\s?(am|pm)?$/i.exec(token.trim());
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = match[2] ?? "00";
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function parseSchedule(text: string): ScheduleSpec | undefined {
  const match = SCHEDULE_PATTERN.exec(text);
  if (!match?.[1]) return undefined;
  const recurrence = RECURRENCE_WORDS[match[1].toLowerCase()];
  if (!recurrence) return undefined;
  const atTime = parseTimeToken(match.groups?.["time"]);
  return atTime ? { recurrence, atTime } : { recurrence };
}

/**
 * Rule-based natural-language understanding for the six request shapes the
 * planner brief lists. Callers needing NLU-quality parsing (an LLM-backed
 * classifier, for example) inject their own `IntentParserFn` via the
 * constructor — this mirrors `@ryper/voice-engine`'s `IntentDetector`
 * pattern of "custom detector first, deterministic fallback second".
 */
export class IntentParser {
  constructor(private readonly customParser?: IntentParserFn) {}

  parse(text: string): ParsedIntent {
    const custom = this.customParser?.(text.trim());
    if (custom) return custom;
    return this.parseDeterministic(text.trim());
  }

  private parseDeterministic(raw: string): ParsedIntent {
    const recursiveMatch = RECURSIVE_PATTERN.exec(raw);
    if (recursiveMatch?.[1]) {
      const schedule = parseSchedule(recursiveMatch[1]) ?? { recurrence: "weekdays" as const };
      return {
        raw,
        shape: "recursive",
        clauses: [raw],
        schedule,
        parallel: false,
        recursive: true,
      };
    }

    const conditional = parseConditional(raw);
    if (conditional) {
      return {
        raw,
        shape: "conditional",
        clauses: [conditional.action],
        condition: conditional,
        parallel: false,
        recursive: false,
      };
    }

    const schedule = parseSchedule(raw);
    if (schedule) {
      const withoutSchedule = raw.replace(SCHEDULE_PATTERN, "").trim();
      const { clauses } = splitClauses(withoutSchedule || raw);
      return {
        raw,
        shape: "scheduled",
        clauses: clauses.length > 0 ? clauses : [raw],
        schedule,
        parallel: false,
        recursive: false,
      };
    }

    const { clauses, parallel } = splitClauses(raw);
    if (clauses.length <= 1) {
      return {
        raw,
        shape: "simple",
        clauses: [raw],
        parallel: false,
        recursive: false,
      };
    }

    return {
      raw,
      shape: parallel ? "parallel" : "multi_step",
      clauses,
      parallel,
      recursive: false,
    };
  }
}

export function createIntentParser(customParser?: IntentParserFn): IntentParser {
  return new IntentParser(customParser);
}

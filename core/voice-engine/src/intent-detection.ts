import type { VoiceCommandMatch } from "./types.js";

export type IntentPattern = {
  readonly intent: string;
  readonly pattern: RegExp;
  readonly slotNames?: readonly string[];
};

export type IntentDetectorFn = (transcript: string) => VoiceCommandMatch | undefined;

/** Built-in patterns for every example command the brief lists — real regex matches, not placeholders. */
const defaultPatterns: readonly IntentPattern[] = [
  { intent: "open_application", pattern: /^open (?<app>.+)$/i, slotNames: ["app"] },
  {
    intent: "search_files",
    pattern: /^(?:search|find) (?:files? )?(?:for )?(?<query>.+)$/i,
    slotNames: ["query"],
  },
  { intent: "edit_pdf", pattern: /^edit (?:the )?pdf(?: (?<target>.+))?$/i, slotNames: ["target"] },
  {
    intent: "edit_image",
    pattern: /^edit (?:the )?(?:image|photo)(?: (?<target>.+))?$/i,
    slotNames: ["target"],
  },
  {
    intent: "summarize_document",
    pattern: /^summari[sz]e (?:the )?(?:document|doc) ?(?<target>.*)$/i,
    slotNames: ["target"],
  },
  { intent: "create_reminder", pattern: /^remind me to (?<task>.+)$/i, slotNames: ["task"] },
  {
    intent: "control_smart_home",
    pattern: /^turn (?<state>on|off) (?:the )?(?<device>.+)$/i,
    slotNames: ["state", "device"],
  },
  { intent: "run_automation", pattern: /^run (?:automation )?(?<name>.+)$/i, slotNames: ["name"] },
  {
    intent: "open_website",
    pattern: /^(?:open|go to) (?:website )?(?<url>[\w.-]+\.\w+.*)$/i,
    slotNames: ["url"],
  },
  {
    intent: "create_note",
    pattern: /^(?:create|take|make) a note(?: that says)? (?<content>.+)$/i,
    slotNames: ["content"],
  },
];

function matchPattern(transcript: string, pattern: IntentPattern): VoiceCommandMatch | undefined {
  const match = pattern.pattern.exec(transcript.trim());
  if (!match) return undefined;
  const slots: Record<string, string> = {};
  for (const name of pattern.slotNames ?? []) {
    const value = match.groups?.[name];
    if (value) slots[name] = value.trim();
  }
  return { intent: pattern.intent, slots, confidence: 0.9 };
}

/**
 * Pattern-matches a transcript against known command shapes. No match
 * means "this is conversational, not a command" — the pipeline falls
 * through to the Core AI Engine rather than the Voice Command Router.
 * Callers needing NLU-quality detection inject their own `IntentDetectorFn`
 * (e.g. backed by a local/cloud model) via the constructor.
 */
export class IntentDetector {
  constructor(
    private readonly patterns: readonly IntentPattern[] = defaultPatterns,
    private readonly customDetector?: IntentDetectorFn,
  ) {}

  detect(transcript: string): VoiceCommandMatch | undefined {
    if (this.customDetector) {
      const custom = this.customDetector(transcript);
      if (custom) return custom;
    }
    for (const pattern of this.patterns) {
      const match = matchPattern(transcript, pattern);
      if (match) return match;
    }
    return undefined;
  }
}

export function createIntentDetector(
  patterns?: readonly IntentPattern[],
  customDetector?: IntentDetectorFn,
): IntentDetector {
  return new IntentDetector(patterns, customDetector);
}

import type { MemoryType } from "./types.js";

export type Classifier = (content: string) => MemoryType | undefined;

/**
 * A small, explainable keyword heuristic — not a model call — used when
 * the caller hasn't already decided a memory's type. Any component that
 * wants ML-quality classification injects its own `Classifier` (e.g. one
 * backed by `@ryper/local-runtime`'s chat/embedding models) via the
 * constructor; this default exists so the system works out of the box.
 */
const keywordRules: ReadonlyArray<{ type: MemoryType; keywords: readonly string[] }> = [
  { type: "preference", keywords: ["prefer", "favorite", "i like", "i don't like", "i hate"] },
  { type: "contact", keywords: ["email", "phone number", "address is", "works at"] },
  {
    type: "calendar",
    keywords: ["meeting", "appointment", "scheduled for", "on monday", "on tuesday"],
  },
  { type: "task", keywords: ["todo", "to-do", "remind me", "need to", "task:"] },
  { type: "project", keywords: ["project", "milestone", "deadline"] },
  { type: "document", keywords: ["document", "pdf", "report"] },
  { type: "image", keywords: ["photo", "image", "picture", "screenshot"] },
  { type: "file", keywords: ["file", "attachment", "download"] },
  { type: "automation", keywords: ["automation", "workflow", "trigger", "if this then"] },
  { type: "conversation", keywords: ["we discussed", "earlier you said", "in our conversation"] },
];

function defaultClassify(content: string): MemoryType | undefined {
  const lower = content.toLowerCase();
  for (const rule of keywordRules) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return rule.type;
    }
  }
  return undefined;
}

export class MemoryCategorizer {
  constructor(
    private readonly classifier: Classifier = defaultClassify,
    private readonly fallback: MemoryType = "long_term",
  ) {}

  categorize(content: string): MemoryType {
    return this.classifier(content) ?? this.fallback;
  }
}

export function createMemoryCategorizer(
  classifier?: Classifier,
  fallback?: MemoryType,
): MemoryCategorizer {
  return new MemoryCategorizer(classifier, fallback);
}

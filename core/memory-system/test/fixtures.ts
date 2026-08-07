import type { CreateMemoryInput } from "../src/types.js";

export function sampleInput(overrides: Partial<CreateMemoryInput> = {}): CreateMemoryInput {
  return {
    type: "preference",
    content: "prefers dark mode",
    ...overrides,
  };
}

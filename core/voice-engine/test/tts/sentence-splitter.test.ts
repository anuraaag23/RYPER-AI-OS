import { describe, expect, it } from "vitest";
import { chunkForSpeech, splitIntoSentences } from "../../src/tts/sentence-splitter.js";

describe("splitIntoSentences", () => {
  it("splits on periods, exclamation points, and question marks", () => {
    expect(splitIntoSentences("Ten AM. Don't be late! Any questions?")).toEqual([
      "Ten AM.",
      "Don't be late!",
      "Any questions?",
    ]);
  });

  it("returns a single sentence unchanged when there's no terminal punctuation", () => {
    expect(splitIntoSentences("Ten AM")).toEqual(["Ten AM"]);
  });

  it("returns an empty array for empty/whitespace-only input", () => {
    expect(splitIntoSentences("")).toEqual([]);
    expect(splitIntoSentences("   ")).toEqual([]);
  });

  it("does not split on a period inside a known abbreviation", () => {
    expect(splitIntoSentences("Dr. Smith is here.")).toEqual(["Dr. Smith is here."]);
  });

  it("does not split on a period not followed by whitespace (e.g. a decimal number)", () => {
    expect(splitIntoSentences("The total is 12.5 dollars.")).toEqual([
      "The total is 12.5 dollars.",
    ]);
  });

  it("trims whitespace between sentences", () => {
    expect(splitIntoSentences("First.   Second.")).toEqual(["First.", "Second."]);
  });

  it("handles trailing text with no terminal punctuation as its own sentence", () => {
    expect(splitIntoSentences("First. and then some trailing text")).toEqual([
      "First.",
      "and then some trailing text",
    ]);
  });
});

describe("chunkForSpeech", () => {
  it("returns sentences unchanged when there's only one", () => {
    expect(chunkForSpeech("Just one sentence here.")).toEqual(["Just one sentence here."]);
  });

  it("merges very short sentences with a neighbor rather than making a tiny synthesis call", () => {
    const result = chunkForSpeech("Yes. No. That is a much longer sentence to speak.", 12);
    expect(result.length).toBeLessThan(3);
    expect(result.join(" ")).toContain("Yes.");
    expect(result.join(" ")).toContain("No.");
  });

  it("never drops the final trailing content", () => {
    const result = chunkForSpeech("A. B. C.", 100);
    expect(result.join(" ")).toBe("A. B. C.");
  });

  it("keeps normal-length sentences as separate chunks for real pipelined playback", () => {
    const result = chunkForSpeech(
      "Your meeting tomorrow is scheduled for ten AM. Please arrive a few minutes early.",
    );
    expect(result).toHaveLength(2);
  });
});

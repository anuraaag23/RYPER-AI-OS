import { describe, expect, it } from "vitest";
import { IntentDetector, DEFAULT_INTENT_PATTERNS } from "@ryper/voice-engine";
import { DESKTOP_INTENT_PATTERNS } from "../electron/voice-commands.js";

/**
 * Real regression coverage for a real bug found while writing
 * `text-chat.test.ts`: the original power-action patterns
 * (`/^shut ?down(?: (?:the )?(?:pc|computer))?$/i`, similarly for
 * `restart`) accepted "shut down the pc" but not "shut down my pc" —
 * arguably the more natural phrasing, and one an end-to-end test
 * caught failing for real (matched no intent at all, so
 * `HeuristicToolCallingProvider` fell through to its "no
 * pattern-matched" fallback instead of ever reaching the shutdown
 * tool). Fixed to accept "my"/"the"/"this" and no determiner at all;
 * these tests pin that fix and exercise the actual regex, which the
 * previous session's unit tests never did (they constructed
 * `VoiceCommandMatch` objects directly, bypassing pattern matching).
 */
const detector = new IntentDetector([...DEFAULT_INTENT_PATTERNS, ...DESKTOP_INTENT_PATTERNS]);

describe("DESKTOP_INTENT_PATTERNS — power actions match real natural phrasing", () => {
  it.each([
    "shutdown",
    "shut down",
    "shut down the pc",
    "shut down the computer",
    "shut down my pc",
    "shut down my computer",
    "shutdown pc",
    "shutdown computer",
  ])('matches "%s" to the shutdown intent', (transcript) => {
    expect(detector.detect(transcript)?.intent).toBe("shutdown");
  });

  it.each([
    "restart",
    "restart the pc",
    "restart the computer",
    "restart my pc",
    "restart my computer",
    "restart this computer",
  ])('matches "%s" to the restart intent', (transcript) => {
    expect(detector.detect(transcript)?.intent).toBe("restart");
  });

  it.each(["sleep", "go to sleep"])('matches "%s" to the sleep intent', (transcript) => {
    expect(detector.detect(transcript)?.intent).toBe("sleep");
  });

  it("does not match unrelated text containing 'pc' or 'computer' as a power action", () => {
    expect(detector.detect("my computer is running slow")?.intent).not.toBe("shutdown");
    expect(detector.detect("my computer is running slow")?.intent).not.toBe("restart");
  });
});

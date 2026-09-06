import { describe, expect, it } from "vitest";
import { IntentParser } from "../src/intent-parser.js";

describe("IntentParser", () => {
  const parser = new IntentParser();

  it("parses a simple command", () => {
    const intent = parser.parse("Open Calculator.");
    expect(intent.shape).toBe("simple");
    expect(intent.clauses).toEqual(["Open Calculator."]);
  });

  it("parses a multi-step request into ordered clauses", () => {
    const intent = parser.parse(
      "Open YouTube, search for Interstellar soundtrack, play the first result, then lower the volume.",
    );
    expect(intent.shape).toBe("multi_step");
    expect(intent.clauses).toHaveLength(4);
    expect(intent.clauses[0]).toBe("Open YouTube");
    expect(intent.clauses[3]).toBe("lower the volume.");
  });

  it("parses a conditional request", () => {
    const intent = parser.parse("If Wi-Fi disconnects, notify me.");
    expect(intent.shape).toBe("conditional");
    expect(intent.condition?.trigger).toBe("Wi-Fi disconnects");
    expect(intent.condition?.action).toBe("notify me.");
  });

  it("parses a scheduled request with a time", () => {
    const intent = parser.parse("Every morning at 7 AM read my calendar.");
    expect(intent.shape).toBe("scheduled");
    expect(intent.schedule).toEqual({ recurrence: "daily", atTime: "07:00" });
  });

  it("parses a parallel request", () => {
    const intent = parser.parse("Summarize this PDF while downloading today's emails.");
    expect(intent.shape).toBe("parallel");
    expect(intent.parallel).toBe(true);
    expect(intent.clauses).toEqual(["Summarize this PDF", "downloading today's emails."]);
  });

  it("parses a recursive request", () => {
    const intent = parser.parse("Repeat this workflow every weekday.");
    expect(intent.shape).toBe("recursive");
    expect(intent.recursive).toBe(true);
    expect(intent.schedule?.recurrence).toBe("weekdays");
  });

  it("prefers an injected custom parser over the deterministic fallback", () => {
    const custom = new IntentParser(() => ({
      raw: "custom",
      shape: "simple",
      clauses: ["custom"],
      parallel: false,
      recursive: false,
    }));
    expect(custom.parse("anything").raw).toBe("custom");
  });
});

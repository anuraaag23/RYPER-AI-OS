import { describe, expect, it } from "vitest";
import {
  compareVersions,
  InvalidVersionError,
  isWithinRange,
  parseVersion,
} from "../src/semver.js";

describe("parseVersion", () => {
  it("parses a valid MAJOR.MINOR.PATCH version", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("throws InvalidVersionError for a malformed version", () => {
    expect(() => parseVersion("1.2")).toThrow(InvalidVersionError);
    expect(() => parseVersion("v1.2.3")).toThrow(InvalidVersionError);
    expect(() => parseVersion("")).toThrow(InvalidVersionError);
  });
});

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.0.0")).toBe(1);
    expect(compareVersions("1.1.0", "1.0.9")).toBe(1);
    expect(compareVersions("1.0.1", "1.0.2")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
});

describe("isWithinRange", () => {
  it("returns true for a version inside an inclusive range", () => {
    expect(isWithinRange("1.5.0", "1.0.0", "2.0.0")).toBe(true);
    expect(isWithinRange("1.0.0", "1.0.0", "2.0.0")).toBe(true);
    expect(isWithinRange("2.0.0", "1.0.0", "2.0.0")).toBe(true);
  });

  it("returns false for a version outside the range", () => {
    expect(isWithinRange("0.9.0", "1.0.0", "2.0.0")).toBe(false);
    expect(isWithinRange("2.0.1", "1.0.0", "2.0.0")).toBe(false);
  });
});

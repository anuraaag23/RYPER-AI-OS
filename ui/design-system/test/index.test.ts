import { describe, expect, it } from "vitest";
import { applyReducedMotion, glassPresets, radiusTokens } from "../src/index.js";

describe("design tokens", () => {
  it("exposes a fixed, small set of radius steps", () => {
    expect(radiusTokens.sm).toBeLessThan(radiusTokens.md);
    expect(radiusTokens.md).toBeLessThan(radiusTokens.lg);
  });

  it("every glass preset defines a fallback blur for non-supporting renderers", () => {
    for (const preset of Object.values(glassPresets)) {
      expect(preset.fallbackBlur).toBeGreaterThan(0);
    }
  });

  it("applyReducedMotion zeroes displacement while keeping other properties", () => {
    const reduced = applyReducedMotion(glassPresets.dock);
    expect(reduced.scale).toBe(0);
    expect(reduced.chroma).toBe(0);
    expect(reduced.blur).toBe(glassPresets.dock.blur);
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { colorTokens, glassPresets } from "@ryper/design-system";
import { applyDesignTokens, resolveColorScheme } from "../src/lib/apply-tokens.js";

afterEach(() => {
  document.documentElement.style.cssText = "";
  delete document.documentElement.dataset["scheme"];
});

describe("applyDesignTokens", () => {
  it("applies the real @ryper/design-system color tokens, not hand-duplicated values", () => {
    applyDesignTokens("dark");
    const styles = getComputedStyle(document.documentElement);
    expect(styles.getPropertyValue("--color-background").trim()).toBe(colorTokens.background.dark);
    expect(styles.getPropertyValue("--color-accent").trim()).toBe(colorTokens.accent);
  });

  it("applies the light scheme's own token values, not dark's", () => {
    applyDesignTokens("light");
    const styles = getComputedStyle(document.documentElement);
    expect(styles.getPropertyValue("--color-background").trim()).toBe(colorTokens.background.light);
  });

  it("applies real glass preset values for each named preset", () => {
    applyDesignTokens("dark");
    const styles = getComputedStyle(document.documentElement);
    expect(styles.getPropertyValue("--glass-dock-blur").trim()).toBe(`${glassPresets.dock.blur}px`);
    expect(styles.getPropertyValue("--glass-assistant-blur").trim()).toBe(
      `${glassPresets.floatingAssistant.blur}px`,
    );
  });

  it("sets the scheme as a data attribute for CSS scoping", () => {
    applyDesignTokens("light");
    expect(document.documentElement.dataset["scheme"]).toBe("light");
  });
});

describe("resolveColorScheme", () => {
  it("passes through explicit light/dark unchanged", () => {
    expect(resolveColorScheme("light")).toBe("light");
    expect(resolveColorScheme("dark")).toBe("dark");
  });

  it("resolves 'system' via matchMedia when available", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
    })) as typeof window.matchMedia;
    expect(resolveColorScheme("system")).toBe("dark");
    window.matchMedia = originalMatchMedia;
  });
});

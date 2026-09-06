import {
  colorTokens,
  glassPresets,
  motionTokens,
  radiusTokens,
  type GlassPresetName,
} from "@ryper/design-system";

export type ColorScheme = "light" | "dark";

function setGlassVars(prefix: string, preset: (typeof glassPresets)[GlassPresetName]): string[] {
  return [
    `--glass-${prefix}-blur: ${preset.blur}px`,
    `--glass-${prefix}-fallback-blur: ${preset.fallbackBlur}px`,
    `--glass-${prefix}-saturate: ${preset.saturate}`,
    `--glass-${prefix}-border-alpha: ${preset.border}`,
    `--glass-${prefix}-chroma: ${preset.chroma}`,
    `--glass-${prefix}-scale: ${preset.scale}`,
  ];
}

/**
 * Sets every design token this renderer uses as a `:root` CSS custom
 * property, read directly from `@ryper/design-system` — the real,
 * shared, RC1-certified token package every native shell's own README
 * says it's meant to theme from. No value here is duplicated by hand in
 * a `.css` file; changing a token upstream changes it here automatically.
 */
export function applyDesignTokens(scheme: ColorScheme): void {
  const root = document.documentElement;
  const vars: string[] = [
    `--color-background: ${colorTokens.background[scheme]}`,
    `--color-surface: ${colorTokens.surface[scheme]}`,
    `--color-accent: ${colorTokens.accent}`,
    `--color-text-primary: ${colorTokens.textPrimary[scheme]}`,
    `--color-text-secondary: ${colorTokens.textSecondary[scheme]}`,
    `--radius-sm: ${radiusTokens.sm}px`,
    `--radius-md: ${radiusTokens.md}px`,
    `--radius-lg: ${radiusTokens.lg}px`,
    `--radius-pill: ${radiusTokens.pill}px`,
    `--motion-fast: ${motionTokens.durationFastMs}ms`,
    `--motion-base: ${motionTokens.durationBaseMs}ms`,
    `--motion-slow: ${motionTokens.durationSlowMs}ms`,
    `--motion-easing-standard: ${motionTokens.easingStandard}`,
    `--motion-easing-decelerate: ${motionTokens.easingDecelerate}`,
    ...setGlassVars("dock", glassPresets.dock),
    ...setGlassVars("assistant", glassPresets.floatingAssistant),
    ...setGlassVars("panel", glassPresets.panel),
  ];
  root.style.cssText += vars.map((v) => `${v};`).join("");
  root.dataset["scheme"] = scheme;
}

export function resolveColorScheme(preference: "light" | "dark" | "system"): ColorScheme {
  if (preference !== "system") return preference;
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

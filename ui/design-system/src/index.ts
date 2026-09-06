export const colorTokens = {
  background: { light: "#F5F6FA", dark: "#0E0E16" },
  surface: { light: "#FFFFFF", dark: "#17171F" },
  accent: "#5B7CFA",
  textPrimary: { light: "#12131A", dark: "#F2F3F7" },
  textSecondary: { light: "#5B5E6B", dark: "#A0A3B1" },
} as const;

export const radiusTokens = {
  sm: 12,
  md: 20,
  lg: 28,
  pill: 999,
} as const;

export const motionTokens = {
  durationFastMs: 120,
  durationBaseMs: 220,
  durationSlowMs: 360,
  easingStandard: "cubic-bezier(0.2, 0, 0, 1)",
  easingDecelerate: "cubic-bezier(0, 0, 0, 1)",
} as const;

/**
 * Parameters for the liquid-glass optics module (see the project's
 * `liquid-glass.js` reference implementation). These are the *approved*
 * per-surface presets — components should reference a preset rather than
 * inventing new scale/chroma values, so the material stays consistent.
 */
export interface GlassPreset {
  readonly scale: number;
  readonly chroma: number;
  readonly border: number;
  readonly mapBlur: number;
  readonly blur: number;
  readonly saturate: number;
  readonly fallbackBlur: number;
}

export const glassPresets = {
  dock: {
    scale: -96,
    chroma: 5,
    border: 0.08,
    mapBlur: 10,
    blur: 4,
    saturate: 1.4,
    fallbackBlur: 18,
  },
  floatingAssistant: {
    scale: -128,
    chroma: 7,
    border: 0.07,
    mapBlur: 14,
    blur: 3,
    saturate: 1.5,
    fallbackBlur: 16,
  },
  panel: {
    scale: -60,
    chroma: 3,
    border: 0.1,
    mapBlur: 12,
    blur: 6,
    saturate: 1.3,
    fallbackBlur: 20,
  },
} as const satisfies Record<string, GlassPreset>;

export type GlassPresetName = keyof typeof glassPresets;

export interface ReducedMotionOverride {
  readonly disableDisplacement: true;
  readonly disableParallax: true;
}

/** Per the design system's accessibility rule: reduced motion turns off displacement/parallax, never the whole component. */
export function applyReducedMotion(preset: GlassPreset): GlassPreset & { chroma: 0; scale: 0 } {
  return { ...preset, chroma: 0, scale: 0 };
}

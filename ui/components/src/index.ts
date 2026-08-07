import { glassPresets, type GlassPresetName } from "@ryper/design-system";

export type VoiceOrbState = "idle" | "listening" | "thinking" | "speaking";

export interface VoiceOrbViewModel {
  readonly state: VoiceOrbState;
  readonly glassPreset: GlassPresetName;
  readonly pulse: boolean;
}

/** Pure function from app state to view-model — platform shells render this however is native. */
export function buildVoiceOrbViewModel(state: VoiceOrbState): VoiceOrbViewModel {
  return {
    state,
    glassPreset: "floatingAssistant",
    pulse: state === "listening" || state === "speaking",
  };
}

export interface DockItem {
  readonly id: string;
  readonly label: string;
  readonly iconId: string;
  readonly pinned: boolean;
}

export interface GlassDockViewModel {
  readonly items: readonly DockItem[];
  readonly glassPreset: GlassPresetName;
}

export function buildGlassDockViewModel(items: readonly DockItem[]): GlassDockViewModel {
  return {
    items: [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned)),
    glassPreset: "dock",
  };
}

export interface FloatingAssistantViewModel {
  readonly open: boolean;
  readonly glassPreset: GlassPresetName;
  readonly widthPx: number;
}

export function buildFloatingAssistantViewModel(open: boolean): FloatingAssistantViewModel {
  return {
    open,
    glassPreset: "floatingAssistant",
    // Kept under ~800px per side per the design system's perf-budget guidance for glass surfaces.
    widthPx: 420,
  };
}

export function resolveGlassPreset(name: GlassPresetName) {
  return glassPresets[name];
}

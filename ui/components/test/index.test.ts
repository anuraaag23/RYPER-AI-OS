import { describe, expect, it } from "vitest";
import {
  buildVoiceOrbViewModel,
  buildGlassDockViewModel,
  buildFloatingAssistantViewModel,
} from "../src/index.js";

describe("VoiceOrb view-model", () => {
  it("pulses while listening or speaking, not while idle or thinking", () => {
    expect(buildVoiceOrbViewModel("listening").pulse).toBe(true);
    expect(buildVoiceOrbViewModel("speaking").pulse).toBe(true);
    expect(buildVoiceOrbViewModel("idle").pulse).toBe(false);
    expect(buildVoiceOrbViewModel("thinking").pulse).toBe(false);
  });
});

describe("GlassDock view-model", () => {
  it("sorts pinned items before unpinned ones", () => {
    const vm = buildGlassDockViewModel([
      { id: "a", label: "A", iconId: "a", pinned: false },
      { id: "b", label: "B", iconId: "b", pinned: true },
    ]);
    expect(vm.items[0]?.id).toBe("b");
  });
});

describe("FloatingAssistant view-model", () => {
  it("keeps surface width within the glass performance budget", () => {
    const vm = buildFloatingAssistantViewModel(true);
    expect(vm.widthPx).toBeLessThanOrEqual(800);
    expect(vm.open).toBe(true);
  });
});

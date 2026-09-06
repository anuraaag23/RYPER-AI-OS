import { describe, expect, it } from "vitest";
import { ModelRegistry } from "../src/model-registry.js";
import { ModelSelector, defaultModelSelectionPolicy } from "../src/model-selection-policy.js";
import { sampleModel, sampleDevice } from "./fixtures.js";

function installed(registry: ModelRegistry, metadata: ReturnType<typeof sampleModel>) {
  registry.markInstalled({
    metadata,
    localPath: `/x/${metadata.id}`,
    installedAt: "now",
    sizeBytes: 1,
    active: true,
  });
}

describe("defaultModelSelectionPolicy", () => {
  it("filters out models the device doesn't have enough RAM for", () => {
    const models = [
      sampleModel({ id: "big", requirements: { minRamGB: 32, approxDiskBytes: 1 } }),
      sampleModel({ id: "small", requirements: { minRamGB: 1, approxDiskBytes: 1 } }),
    ];
    const ranked = defaultModelSelectionPolicy(models, {
      taskType: "chat",
      device: sampleDevice({ freeRamGB: 8 }),
    });
    expect(ranked.map((m) => m.id)).toEqual(["small"]);
  });

  it("filters out GPU-requiring models on a device with no GPU", () => {
    const models = [
      sampleModel({
        id: "gpu-only",
        requirements: { minRamGB: 1, approxDiskBytes: 1, requiresGpu: true },
      }),
    ];
    const ranked = defaultModelSelectionPolicy(models, {
      taskType: "chat",
      device: sampleDevice({ hasGpu: false }),
    });
    expect(ranked).toHaveLength(0);
  });

  it("ranks the preferred model first when it's eligible", () => {
    const models = [
      sampleModel({ id: "a", requirements: { minRamGB: 1, approxDiskBytes: 500 } }),
      sampleModel({ id: "b", requirements: { minRamGB: 1, approxDiskBytes: 100 } }),
    ];
    const ranked = defaultModelSelectionPolicy(models, {
      taskType: "chat",
      device: sampleDevice(),
      preferredModelId: "a",
    });
    expect(ranked[0]?.id).toBe("a");
  });

  it("otherwise prefers smaller models", () => {
    const models = [
      sampleModel({ id: "big", requirements: { minRamGB: 1, approxDiskBytes: 500 } }),
      sampleModel({ id: "small", requirements: { minRamGB: 1, approxDiskBytes: 100 } }),
    ];
    const ranked = defaultModelSelectionPolicy(models, {
      taskType: "chat",
      device: sampleDevice(),
    });
    expect(ranked.map((m) => m.id)).toEqual(["small", "big"]);
  });
});

describe("ModelSelector", () => {
  it("only considers installed models by default", () => {
    const registry = new ModelRegistry();
    registry.addToCatalog(sampleModel({ id: "not-installed" }));
    installed(registry, sampleModel({ id: "installed" }));

    const selector = new ModelSelector(registry);
    const chosen = selector.select({ taskType: "chat", device: sampleDevice() });
    expect(chosen?.id).toBe("installed");
  });

  it("selectRanked exposes the full ordered candidate list", () => {
    const registry = new ModelRegistry();
    installed(
      registry,
      sampleModel({ id: "a", requirements: { minRamGB: 1, approxDiskBytes: 200 } }),
    );
    installed(
      registry,
      sampleModel({ id: "b", requirements: { minRamGB: 1, approxDiskBytes: 100 } }),
    );

    const selector = new ModelSelector(registry);
    const ranked = selector.selectRanked({ taskType: "chat", device: sampleDevice() });
    expect(ranked.map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("returns undefined when nothing is eligible", () => {
    const registry = new ModelRegistry();
    const selector = new ModelSelector(registry);
    expect(selector.select({ taskType: "chat", device: sampleDevice() })).toBeUndefined();
  });
});

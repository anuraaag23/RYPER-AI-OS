import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../src/filesystem.js";
import { ModelRegistry } from "../src/model-registry.js";
import { ModelCache } from "../src/model-cache.js";
import { sampleModel } from "./fixtures.js";

async function installModel(
  registry: ModelRegistry,
  fs: InMemoryFileSystem,
  id: string,
  sizeBytes: number,
) {
  const path = `/cache/${id}.bin`;
  await fs.writeFile(path, new Uint8Array(sizeBytes));
  registry.markInstalled({
    metadata: sampleModel({ id }),
    localPath: path,
    installedAt: "now",
    sizeBytes,
    active: true,
  });
}

describe("ModelCache", () => {
  it("reports disk usage across every installed model", async () => {
    const registry = new ModelRegistry();
    const fs = new InMemoryFileSystem();
    await installModel(registry, fs, "a", 100);
    await installModel(registry, fs, "b", 200);

    const cache = new ModelCache(registry, fs, 1000);
    const usage = cache.diskUsage();
    expect(usage.totalBytes).toBe(300);
    expect(usage.utilizationPercent).toBeCloseTo(30, 5);
  });

  it("does not evict anything while under budget", async () => {
    const registry = new ModelRegistry();
    const fs = new InMemoryFileSystem();
    await installModel(registry, fs, "a", 100);
    const cache = new ModelCache(registry, fs, 1000);
    expect(await cache.enforceLimit()).toEqual([]);
  });

  it("evicts least-recently-used models first once over budget", async () => {
    const registry = new ModelRegistry();
    const fs = new InMemoryFileSystem();
    await installModel(registry, fs, "old", 100);
    await installModel(registry, fs, "new", 100);

    const cache = new ModelCache(registry, fs, 150);
    cache.recordUse("old", 1000);
    cache.recordUse("new", 2000);

    const evicted = await cache.enforceLimit();
    expect(evicted).toEqual(["old"]);
    expect(registry.isInstalled("old")).toBe(false);
    expect(registry.isInstalled("new")).toBe(true);
  });

  it("treats never-used models as the oldest", async () => {
    const registry = new ModelRegistry();
    const fs = new InMemoryFileSystem();
    await installModel(registry, fs, "used", 100);
    await installModel(registry, fs, "never-used", 100);

    const cache = new ModelCache(registry, fs, 150);
    cache.recordUse("used", 5000);

    const evicted = await cache.enforceLimit();
    expect(evicted).toEqual(["never-used"]);
  });
});

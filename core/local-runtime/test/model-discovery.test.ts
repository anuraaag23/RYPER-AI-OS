import { describe, expect, it } from "vitest";
import { ModelRegistry } from "../src/model-registry.js";
import { ModelDiscoveryService } from "../src/model-discovery.js";
import { sampleModel } from "./fixtures.js";

describe("ModelDiscoveryService", () => {
  it("merges models from every registered source into the registry", async () => {
    const registry = new ModelRegistry();
    const discovery = new ModelDiscoveryService(registry);
    discovery.addSource({ id: "local-dir", list: async () => [sampleModel({ id: "a" })] });
    discovery.addSource({ id: "remote-catalog", list: async () => [sampleModel({ id: "b" })] });

    const result = await discovery.discover();
    expect(result.discovered).toBe(2);
    expect(registry.getMetadata("a")).toBeDefined();
    expect(registry.getMetadata("b")).toBeDefined();
  });

  it("continues past a failing source and reports it rather than throwing", async () => {
    const registry = new ModelRegistry();
    const discovery = new ModelDiscoveryService(registry);
    discovery.addSource({
      id: "broken",
      list: async () => {
        throw new Error("network down");
      },
    });
    discovery.addSource({ id: "ok", list: async () => [sampleModel({ id: "a" })] });

    const result = await discovery.discover();
    expect(result.sourcesFailed).toBe(1);
    expect(result.discovered).toBe(1);
    expect(registry.getMetadata("a")).toBeDefined();
  });

  it("later sources win on id conflicts", async () => {
    const registry = new ModelRegistry();
    const discovery = new ModelDiscoveryService(registry);
    discovery.addSource({
      id: "s1",
      list: async () => [sampleModel({ id: "a", version: "1.0.0" })],
    });
    discovery.addSource({
      id: "s2",
      list: async () => [sampleModel({ id: "a", version: "2.0.0" })],
    });

    await discovery.discover();
    expect(registry.getMetadata("a")?.version).toBe("2.0.0");
  });
});

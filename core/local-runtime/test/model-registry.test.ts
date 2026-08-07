import { describe, expect, it } from "vitest";
import { ModelRegistry } from "../src/model-registry.js";
import { sampleModel } from "./fixtures.js";

describe("ModelRegistry", () => {
  it("adds and retrieves catalog metadata", () => {
    const registry = new ModelRegistry();
    registry.addToCatalog(sampleModel());
    expect(registry.getMetadata("chat-small")?.name).toBe("Chat Small");
  });

  it("query() filters by type, runtime, and installed status", () => {
    const registry = new ModelRegistry();
    registry.addToCatalog(sampleModel({ id: "a", type: "chat", runtime: "ollama" }));
    registry.addToCatalog(sampleModel({ id: "b", type: "embedding", runtime: "onnx" }));

    expect(registry.query({ type: "chat" }).map((m) => m.id)).toEqual(["a"]);
    expect(registry.query({ runtime: "onnx" }).map((m) => m.id)).toEqual(["b"]);
  });

  it("markInstalled/markUninstalled toggle installed status and installedOnly filtering", () => {
    const registry = new ModelRegistry();
    const metadata = sampleModel();
    registry.addToCatalog(metadata);
    expect(registry.query({ installedOnly: true })).toHaveLength(0);

    registry.markInstalled({
      metadata,
      localPath: "/x",
      installedAt: "now",
      sizeBytes: 10,
      active: true,
    });
    expect(registry.isInstalled("chat-small")).toBe(true);
    expect(registry.query({ installedOnly: true })).toHaveLength(1);

    registry.markUninstalled("chat-small");
    expect(registry.isInstalled("chat-small")).toBe(false);
  });

  it("totalInstalledBytes sums every installed model's size", () => {
    const registry = new ModelRegistry();
    registry.markInstalled({
      metadata: sampleModel({ id: "a" }),
      localPath: "/a",
      installedAt: "now",
      sizeBytes: 100,
      active: true,
    });
    registry.markInstalled({
      metadata: sampleModel({ id: "b" }),
      localPath: "/b",
      installedAt: "now",
      sizeBytes: 200,
      active: true,
    });
    expect(registry.totalInstalledBytes()).toBe(300);
  });
});

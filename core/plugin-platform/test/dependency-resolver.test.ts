import { describe, expect, it } from "vitest";
import { createExtensionManifest } from "../src/manifest.js";
import { DependencyResolutionError, PluginDependencyResolver } from "../src/dependency-resolver.js";
import { testPlugin } from "./helpers.js";
import type { ExtensionManifest } from "../src/types.js";

function manifest(
  id: string,
  deps: readonly { id: string; version: string }[] = [],
): ExtensionManifest {
  return createExtensionManifest(testPlugin({ id, extended: { dependencies: deps } }));
}

describe("PluginDependencyResolver", () => {
  const resolver = new PluginDependencyResolver();

  it("resolves a valid install order with dependencies before dependents", () => {
    const a = manifest("plugin-a");
    const b = manifest("plugin-b", [{ id: "plugin-a", version: "1.0.0" }]);
    const c = manifest("plugin-c", [{ id: "plugin-b", version: "1.0.0" }]);
    const { installOrder } = resolver.resolve([c, b, a]);
    expect(installOrder.indexOf("plugin-a")).toBeLessThan(installOrder.indexOf("plugin-b"));
    expect(installOrder.indexOf("plugin-b")).toBeLessThan(installOrder.indexOf("plugin-c"));
  });

  it("throws when a dependency is missing", () => {
    const b = manifest("plugin-b", [{ id: "plugin-a", version: "1.0.0" }]);
    expect(() => resolver.resolve([b])).toThrow(DependencyResolutionError);
  });

  it("throws on a dependency version mismatch", () => {
    const a = manifest("plugin-a");
    const b = manifest("plugin-b", [{ id: "plugin-a", version: "2.0.0" }]);
    expect(() => resolver.resolve([a, b])).toThrow(DependencyResolutionError);
  });

  it("throws on a circular dependency", () => {
    const a = manifest("plugin-a", [{ id: "plugin-b", version: "1.0.0" }]);
    const b = manifest("plugin-b", [{ id: "plugin-a", version: "1.0.0" }]);
    expect(() => resolver.resolve([a, b])).toThrow(DependencyResolutionError);
  });

  it("handles plugins with no dependencies at all", () => {
    const a = manifest("plugin-a");
    const b = manifest("plugin-b");
    const { installOrder } = resolver.resolve([a, b]);
    expect(new Set(installOrder)).toEqual(new Set(["plugin-a", "plugin-b"]));
  });
});

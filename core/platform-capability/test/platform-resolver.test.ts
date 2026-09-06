import { describe, expect, it } from "vitest";
import { AdapterRegistry } from "../src/adapter-registry.js";
import { PlatformResolver } from "../src/platform-resolver.js";
import { buildMockAdapter } from "./helpers.js";

describe("PlatformResolver", () => {
  it("uses the injected detector to determine the active platform", () => {
    const registry = new AdapterRegistry();
    const resolver = new PlatformResolver(registry, () => "android");
    expect(resolver.activePlatform()).toBe("android");
  });

  it("defaults to 'browser' when no detector is injected", () => {
    const resolver = new PlatformResolver(new AdapterRegistry());
    expect(resolver.activePlatform()).toBe("browser");
  });

  it("resolves the registered adapter for the active platform", () => {
    const registry = new AdapterRegistry();
    const adapter = buildMockAdapter({ platform: "windows" });
    registry.register(adapter);
    const resolver = new PlatformResolver(registry, () => "windows");
    expect(resolver.resolveAdapter()).toBe(adapter);
  });

  it("falls back to a null adapter when nothing is registered for the platform", () => {
    const resolver = new PlatformResolver(new AdapterRegistry(), () => "macos");
    const adapter = resolver.resolveAdapter();
    expect(adapter.platform).toBe("macos");
    expect(adapter.supports("notifications")).toBe(false);
  });

  it("allows resolving an explicit platform, overriding the detector", () => {
    const registry = new AdapterRegistry();
    const linuxAdapter = buildMockAdapter({ platform: "linux" });
    registry.register(linuxAdapter);
    const resolver = new PlatformResolver(registry, () => "windows");
    expect(resolver.resolveAdapter("linux")).toBe(linuxAdapter);
  });
});

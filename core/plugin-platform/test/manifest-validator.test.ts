import { describe, expect, it } from "vitest";
import { createExtensionManifest } from "../src/manifest.js";
import { PluginManifestValidator } from "../src/manifest-validator.js";
import { testPlugin } from "./helpers.js";

describe("PluginManifestValidator", () => {
  const validator = new PluginManifestValidator();

  it("accepts a well-formed manifest running an SDK version within range", () => {
    const manifest = createExtensionManifest(testPlugin());
    const result = validator.validate(manifest, "5.0.0");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects a non-kebab-case id", () => {
    const manifest = { ...createExtensionManifest(testPlugin()), id: "Not Kebab" };
    const result = validator.validate(manifest, "5.0.0");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("kebab-case"))).toBe(true);
  });

  it("rejects an invalid version string", () => {
    const manifest = { ...createExtensionManifest(testPlugin()), version: "not-a-version" };
    const result = validator.validate(manifest, "5.0.0");
    expect(result.valid).toBe(false);
  });

  it("rejects minSdkVersion greater than maxSdkVersion", () => {
    const manifest = {
      ...createExtensionManifest(testPlugin()),
      minSdkVersion: "3.0.0",
      maxSdkVersion: "1.0.0",
    };
    const result = validator.validate(manifest, "2.0.0");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("greater than"))).toBe(true);
  });

  it("rejects a manifest incompatible with the current SDK version", () => {
    const manifest = {
      ...createExtensionManifest(testPlugin()),
      minSdkVersion: "10.0.0",
      maxSdkVersion: "11.0.0",
    };
    const result = validator.validate(manifest, "5.0.0");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("requires SDK between"))).toBe(true);
  });

  it("rejects an empty supportedPlatforms list", () => {
    const manifest = { ...createExtensionManifest(testPlugin()), supportedPlatforms: [] };
    const result = validator.validate(manifest, "5.0.0");
    expect(result.valid).toBe(false);
  });

  it("rejects a malformed dependency", () => {
    const manifest = {
      ...createExtensionManifest(testPlugin()),
      dependencies: [{ id: "Bad Id", version: "x.y.z" }],
    };
    const result = validator.validate(manifest, "5.0.0");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

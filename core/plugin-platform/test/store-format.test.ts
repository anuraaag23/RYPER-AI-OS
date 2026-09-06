import { describe, expect, it } from "vitest";
import { createExtensionManifest } from "../src/manifest.js";
import {
  checkVersionCompatibility,
  isValidUpdate,
  signPackage,
  verifyPackageSignature,
  type PluginPackageManifestEnvelope,
} from "../src/store-format.js";
import { testPlugin } from "./helpers.js";

function envelope(
  overrides: Partial<PluginPackageManifestEnvelope> = {},
): PluginPackageManifestEnvelope {
  return {
    manifest: createExtensionManifest(testPlugin()),
    entry: "index.js",
    checksum: "abc123",
    ...overrides,
  };
}

describe("signPackage / verifyPackageSignature", () => {
  it("verifies a signature produced with the same key", () => {
    const signed = signPackage(envelope(), "secret-key");
    expect(verifyPackageSignature(signed, "secret-key")).toBe(true);
  });

  it("rejects a signature verified with the wrong key", () => {
    const signed = signPackage(envelope(), "secret-key");
    expect(verifyPackageSignature(signed, "wrong-key")).toBe(false);
  });

  it("rejects a package whose envelope was tampered with after signing", () => {
    const signed = signPackage(envelope(), "secret-key");
    const tampered = { ...signed, envelope: envelope({ entry: "malicious.js" }) };
    expect(verifyPackageSignature(tampered, "secret-key")).toBe(false);
  });
});

describe("checkVersionCompatibility", () => {
  it("reports compatible when the current SDK version is within range", () => {
    const manifest = createExtensionManifest(
      testPlugin({ extended: { minSdkVersion: "1.0.0", maxSdkVersion: "9.9.9" } }),
    );
    expect(checkVersionCompatibility(manifest, "5.0.0").compatible).toBe(true);
  });

  it("reports incompatible with a reason when the SDK version is out of range", () => {
    const manifest = createExtensionManifest(
      testPlugin({ extended: { minSdkVersion: "1.0.0", maxSdkVersion: "2.0.0" } }),
    );
    const result = checkVersionCompatibility(manifest, "5.0.0");
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("outside");
  });
});

describe("isValidUpdate", () => {
  it("accepts a strictly newer version of the same plugin", () => {
    const from = createExtensionManifest(testPlugin({ version: "1.0.0" }));
    const to = createExtensionManifest(testPlugin({ version: "1.1.0" }));
    expect(isValidUpdate(from, to).compatible).toBe(true);
  });

  it("rejects a same-or-older version", () => {
    const from = createExtensionManifest(testPlugin({ version: "1.1.0" }));
    const to = createExtensionManifest(testPlugin({ version: "1.0.0" }));
    expect(isValidUpdate(from, to).compatible).toBe(false);
  });

  it("rejects a manifest id mismatch", () => {
    const from = createExtensionManifest(testPlugin({ id: "plugin-a" }));
    const to = createExtensionManifest(testPlugin({ id: "plugin-b", version: "2.0.0" }));
    const result = isValidUpdate(from, to);
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("mismatch");
  });
});

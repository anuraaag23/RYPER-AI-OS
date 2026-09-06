import { createHmac, timingSafeEqual } from "node:crypto";
import type { ExtensionManifest } from "./types.js";
import { compareVersions } from "./semver.js";

/**
 * The on-disk/over-the-wire shape a future Plugin Store would transfer.
 * `entry` is a placeholder for wherever the plugin's actual code module
 * lives (a URL, bundle path, etc.) — this package designs the format,
 * per the brief, without implementing a store client.
 */
export interface PluginPackageManifestEnvelope {
  readonly manifest: ExtensionManifest;
  readonly entry: string;
  readonly checksum: string;
}

export interface SignedPluginPackage {
  readonly envelope: PluginPackageManifestEnvelope;
  readonly signature: string;
}

export interface UpdateMetadata {
  readonly pluginId: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly releaseNotes?: string;
  readonly publishedAt: string;
}

function canonicalize(envelope: PluginPackageManifestEnvelope): string {
  return JSON.stringify(envelope, Object.keys(envelope).sort());
}

/**
 * A real, working signing scheme (HMAC-SHA256) so package integrity and
 * "did this come from a trusted publisher" are honestly enforceable
 * today — not a placeholder that always returns `true`. It is
 * deliberately *not* a public-key/PKI scheme: a real Plugin Store would
 * need asymmetric signing with a published trust root, which is exactly
 * the kind of infrastructure "design the architecture... do not
 * implement the online store yet" calls out as future work. Swapping
 * this for RSA/Ed25519 later doesn't change any caller of `signPackage`/
 * `verifyPackageSignature`.
 */
export function signPackage(
  envelope: PluginPackageManifestEnvelope,
  signingKey: string,
): SignedPluginPackage {
  const signature = createHmac("sha256", signingKey).update(canonicalize(envelope)).digest("hex");
  return { envelope, signature };
}

export function verifyPackageSignature(pkg: SignedPluginPackage, signingKey: string): boolean {
  const expected = createHmac("sha256", signingKey)
    .update(canonicalize(pkg.envelope))
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(pkg.signature, "hex");
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}

export interface CompatibilityCheck {
  readonly compatible: boolean;
  readonly reason?: string;
}

/** Whether the platform's current SDK version can run a given manifest, independent of full manifest validation. */
export function checkVersionCompatibility(
  manifest: ExtensionManifest,
  currentSdkVersion: string,
): CompatibilityCheck {
  const aboveMin = compareVersions(currentSdkVersion, manifest.minSdkVersion) >= 0;
  const belowMax = compareVersions(currentSdkVersion, manifest.maxSdkVersion) <= 0;
  if (aboveMin && belowMax) return { compatible: true };
  return {
    compatible: false,
    reason: `platform SDK ${currentSdkVersion} is outside [${manifest.minSdkVersion}, ${manifest.maxSdkVersion}]`,
  };
}

/** Whether `toManifest` is a valid update over `fromManifest` — same id, strictly newer version. */
export function isValidUpdate(
  fromManifest: ExtensionManifest,
  toManifest: ExtensionManifest,
): CompatibilityCheck {
  if (fromManifest.id !== toManifest.id) {
    return {
      compatible: false,
      reason: `manifest id mismatch: "${fromManifest.id}" vs "${toManifest.id}"`,
    };
  }
  if (compareVersions(toManifest.version, fromManifest.version) <= 0) {
    return {
      compatible: false,
      reason: `update version ${toManifest.version} is not newer than installed version ${fromManifest.version}`,
    };
  }
  return { compatible: true };
}

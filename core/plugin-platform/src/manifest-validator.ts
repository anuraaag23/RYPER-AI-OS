import type { ExtensionManifest } from "./types.js";
import { compareVersions, InvalidVersionError, parseVersion } from "./semver.js";
import { getCurrentSdkVersion } from "./manifest.js";

export interface ManifestValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const ID_PATTERN = /^[a-z0-9-]+$/;

/**
 * Structural validation for a manifest before it's installed — defense in
 * depth alongside `@ryper/plugin-sdk`'s own `definePlugin` checks, since a
 * manifest reaching this platform could in principle come from a Plugin
 * Store package (see `store-format.ts`) rather than an in-process
 * `definePlugin()` call.
 */
export class PluginManifestValidator {
  validate(
    manifest: ExtensionManifest,
    currentSdkVersion: string = getCurrentSdkVersion(),
  ): ManifestValidationResult {
    const errors: string[] = [];

    if (!ID_PATTERN.test(manifest.id)) {
      errors.push(`id "${manifest.id}" must be lowercase kebab-case`);
    }
    if (manifest.name.trim().length === 0) {
      errors.push("name must not be empty");
    }

    for (const [label, value] of [
      ["version", manifest.version],
      ["minSdkVersion", manifest.minSdkVersion],
      ["maxSdkVersion", manifest.maxSdkVersion],
    ] as const) {
      try {
        parseVersion(value);
      } catch (err) {
        errors.push(
          err instanceof InvalidVersionError
            ? `${label}: ${err.message}`
            : `${label}: invalid version`,
        );
      }
    }

    if (
      errors.length === 0 &&
      compareVersions(manifest.minSdkVersion, manifest.maxSdkVersion) > 0
    ) {
      errors.push(
        `minSdkVersion (${manifest.minSdkVersion}) is greater than maxSdkVersion (${manifest.maxSdkVersion})`,
      );
    }

    if (errors.length === 0) {
      const withinRange =
        compareVersions(currentSdkVersion, manifest.minSdkVersion) >= 0 &&
        compareVersions(currentSdkVersion, manifest.maxSdkVersion) <= 0;
      if (!withinRange) {
        errors.push(
          `plugin requires SDK between ${manifest.minSdkVersion} and ${manifest.maxSdkVersion}, but the platform is running ${currentSdkVersion}`,
        );
      }
    }

    for (const dependency of manifest.dependencies) {
      if (!ID_PATTERN.test(dependency.id)) {
        errors.push(`dependency id "${dependency.id}" must be lowercase kebab-case`);
      }
      try {
        parseVersion(dependency.version);
      } catch {
        errors.push(`dependency "${dependency.id}" has an invalid version "${dependency.version}"`);
      }
    }

    if (manifest.supportedPlatforms.length === 0) {
      errors.push("supportedPlatforms must list at least one platform");
    }

    return { valid: errors.length === 0, errors };
  }
}

export function createManifestValidator(): PluginManifestValidator {
  return new PluginManifestValidator();
}

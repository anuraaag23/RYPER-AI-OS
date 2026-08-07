import type { LogLevel } from "@ryper/logging";
import type { PlatformId } from "./types.js";

export interface PlatformCapabilityConfig {
  readonly logLevel: LogLevel;
  readonly diagnosticsHistorySize: number;
  readonly defaultPlatform: PlatformId;
}

export class PlatformCapabilityConfigError extends Error {}

const VALID_LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];
const VALID_PLATFORMS: readonly PlatformId[] = [
  "windows",
  "macos",
  "linux",
  "android",
  "ios",
  "browser",
];

function parsePositiveInt(value: string | undefined, fallback: number, fieldName: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new PlatformCapabilityConfigError(
      `invalid ${fieldName} "${value}" — expected a positive integer`,
    );
  }
  return parsed;
}

/** Reads `RYPER_PCL_*` environment variables — same shape as every other Core package's config loader. */
export function loadPlatformCapabilityConfig(
  env: Readonly<Record<string, string | undefined>>,
): PlatformCapabilityConfig {
  const logLevel = (env.RYPER_PCL_LOG_LEVEL ?? "info") as LogLevel;
  if (!VALID_LOG_LEVELS.includes(logLevel)) {
    throw new PlatformCapabilityConfigError(
      `invalid RYPER_PCL_LOG_LEVEL "${logLevel}" — expected one of: ${VALID_LOG_LEVELS.join(", ")}`,
    );
  }
  const defaultPlatform = (env.RYPER_PCL_DEFAULT_PLATFORM ?? "browser") as PlatformId;
  if (!VALID_PLATFORMS.includes(defaultPlatform)) {
    throw new PlatformCapabilityConfigError(
      `invalid RYPER_PCL_DEFAULT_PLATFORM "${defaultPlatform}" — expected one of: ${VALID_PLATFORMS.join(", ")}`,
    );
  }
  return {
    logLevel,
    diagnosticsHistorySize: parsePositiveInt(
      env.RYPER_PCL_DIAGNOSTICS_HISTORY_SIZE,
      200,
      "RYPER_PCL_DIAGNOSTICS_HISTORY_SIZE",
    ),
    defaultPlatform,
  };
}

export const defaultPlatformCapabilityConfig: PlatformCapabilityConfig =
  loadPlatformCapabilityConfig({});

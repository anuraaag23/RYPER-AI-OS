import type { LogLevel } from "@ryper/logging";
import { DEFAULT_SANDBOX_LIMITS, type SandboxLimits } from "./sandbox.js";

export interface PluginPlatformConfig {
  readonly logLevel: LogLevel;
  readonly diagnosticsHistorySize: number;
  readonly sandboxLimits: SandboxLimits;
}

export class PluginPlatformConfigError extends Error {}

const VALID_LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

function parsePositiveInt(value: string | undefined, fallback: number, fieldName: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new PluginPlatformConfigError(
      `invalid ${fieldName} "${value}" — expected a positive integer`,
    );
  }
  return parsed;
}

/** Reads `RYPER_PLUGINS_*` environment variables, mirroring the Planner's and Tool Framework's config loaders. */
export function loadPluginPlatformConfig(
  env: Readonly<Record<string, string | undefined>>,
): PluginPlatformConfig {
  const logLevel = (env.RYPER_PLUGINS_LOG_LEVEL ?? "info") as LogLevel;
  if (!VALID_LOG_LEVELS.includes(logLevel)) {
    throw new PluginPlatformConfigError(
      `invalid RYPER_PLUGINS_LOG_LEVEL "${logLevel}" — expected one of: ${VALID_LOG_LEVELS.join(", ")}`,
    );
  }
  return {
    logLevel,
    diagnosticsHistorySize: parsePositiveInt(
      env.RYPER_PLUGINS_DIAGNOSTICS_HISTORY_SIZE,
      200,
      "RYPER_PLUGINS_DIAGNOSTICS_HISTORY_SIZE",
    ),
    sandboxLimits: {
      maxConcurrentCalls: parsePositiveInt(
        env.RYPER_PLUGINS_SANDBOX_MAX_CONCURRENT_CALLS,
        DEFAULT_SANDBOX_LIMITS.maxConcurrentCalls,
        "RYPER_PLUGINS_SANDBOX_MAX_CONCURRENT_CALLS",
      ),
      callTimeoutMs: parsePositiveInt(
        env.RYPER_PLUGINS_SANDBOX_CALL_TIMEOUT_MS,
        DEFAULT_SANDBOX_LIMITS.callTimeoutMs,
        "RYPER_PLUGINS_SANDBOX_CALL_TIMEOUT_MS",
      ),
      maxPayloadBytes: parsePositiveInt(
        env.RYPER_PLUGINS_SANDBOX_MAX_PAYLOAD_BYTES,
        DEFAULT_SANDBOX_LIMITS.maxPayloadBytes,
        "RYPER_PLUGINS_SANDBOX_MAX_PAYLOAD_BYTES",
      ),
    },
  };
}

export const defaultPluginPlatformConfig: PluginPlatformConfig = loadPluginPlatformConfig({});

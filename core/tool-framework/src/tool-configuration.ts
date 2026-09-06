import type { LogLevel } from "@ryper/logging";

export interface ToolFrameworkConfig {
  readonly logLevel: LogLevel;
  readonly maxConcurrentInvocations: number;
  readonly defaultTimeoutMs: number;
  readonly diagnosticsHistorySize: number;
  readonly logHistorySize: number;
  readonly memoryIntegrationEnabled: boolean;
}

export class ToolFrameworkConfigError extends Error {}

const VALID_LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

function parsePositiveInt(value: string | undefined, fallback: number, fieldName: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ToolFrameworkConfigError(
      `invalid ${fieldName} "${value}" — expected a positive integer`,
    );
  }
  return parsed;
}

/** Reads `RYPER_TOOLS_*` environment variables — same shape/conventions as `@ryper/planner`'s config loader. */
export function loadToolFrameworkConfig(
  env: Readonly<Record<string, string | undefined>>,
): ToolFrameworkConfig {
  const logLevel = (env.RYPER_TOOLS_LOG_LEVEL ?? "info") as LogLevel;
  if (!VALID_LOG_LEVELS.includes(logLevel)) {
    throw new ToolFrameworkConfigError(
      `invalid RYPER_TOOLS_LOG_LEVEL "${logLevel}" — expected one of: ${VALID_LOG_LEVELS.join(", ")}`,
    );
  }
  return {
    logLevel,
    maxConcurrentInvocations: parsePositiveInt(
      env.RYPER_TOOLS_MAX_CONCURRENT_INVOCATIONS,
      4,
      "RYPER_TOOLS_MAX_CONCURRENT_INVOCATIONS",
    ),
    defaultTimeoutMs: parsePositiveInt(
      env.RYPER_TOOLS_DEFAULT_TIMEOUT_MS,
      15_000,
      "RYPER_TOOLS_DEFAULT_TIMEOUT_MS",
    ),
    diagnosticsHistorySize: parsePositiveInt(
      env.RYPER_TOOLS_DIAGNOSTICS_HISTORY_SIZE,
      100,
      "RYPER_TOOLS_DIAGNOSTICS_HISTORY_SIZE",
    ),
    logHistorySize: parsePositiveInt(
      env.RYPER_TOOLS_LOG_HISTORY_SIZE,
      500,
      "RYPER_TOOLS_LOG_HISTORY_SIZE",
    ),
    memoryIntegrationEnabled: parseBool(env.RYPER_TOOLS_MEMORY_INTEGRATION_ENABLED, true),
  };
}

export const defaultToolFrameworkConfig: ToolFrameworkConfig = loadToolFrameworkConfig({});

import type { LogLevel } from "@ryper/logging";

export type RyperEnvironment = "development" | "staging" | "production";

export interface EngineConfig {
  readonly environment: RyperEnvironment;
  readonly logLevel: LogLevel;
  readonly cloudApiBaseUrl: string;
  readonly cloudApiKey: string;
  readonly telemetryEnabled: boolean;
  readonly featureMultiAgent: boolean;
  readonly featureKnowledgeGraph: boolean;
}

const VALID_ENVIRONMENTS: readonly RyperEnvironment[] = ["development", "staging", "production"];
const VALID_LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

export class ConfigValidationError extends Error {}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

function parseEnum<T extends string>(
  value: string | undefined,
  valid: readonly T[],
  fallback: T,
  fieldName: string,
): T {
  if (value === undefined || value === "") return fallback;
  if (!(valid as readonly string[]).includes(value)) {
    throw new ConfigValidationError(
      `invalid ${fieldName} "${value}" — expected one of: ${valid.join(", ")}`,
    );
  }
  return value as T;
}

/**
 * Reads the exact variable names documented in `.env.example` /
 * `docs/ENVIRONMENT.md`. Fails loudly on an invalid enum value rather than
 * silently defaulting, per that document's "fail startup loudly" rule.
 * `env` is injected (rather than reading `process.env` internally) so this
 * is testable without mutating global state.
 */
export function loadEngineConfig(env: Readonly<Record<string, string | undefined>>): EngineConfig {
  return {
    environment: parseEnum(env.RYPER_ENV, VALID_ENVIRONMENTS, "development", "RYPER_ENV"),
    logLevel: parseEnum(env.RYPER_LOG_LEVEL, VALID_LOG_LEVELS, "info", "RYPER_LOG_LEVEL"),
    cloudApiBaseUrl: env.RYPER_CLOUD_API_BASE_URL ?? "https://api.anthropic.com",
    cloudApiKey: env.RYPER_CLOUD_API_KEY ?? "",
    telemetryEnabled: parseBool(env.RYPER_TELEMETRY_ENABLED, false),
    featureMultiAgent: parseBool(env.RYPER_FEATURE_MULTI_AGENT, false),
    featureKnowledgeGraph: parseBool(env.RYPER_FEATURE_KNOWLEDGE_GRAPH, false),
  };
}

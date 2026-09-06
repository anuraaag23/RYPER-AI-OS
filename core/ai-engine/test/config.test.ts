import { describe, expect, it } from "vitest";
import { loadEngineConfig, ConfigValidationError } from "../src/config.js";

describe("loadEngineConfig", () => {
  it("applies documented defaults when nothing is set", () => {
    const config = loadEngineConfig({});
    expect(config).toEqual({
      environment: "development",
      logLevel: "info",
      cloudApiBaseUrl: "https://api.anthropic.com",
      cloudApiKey: "",
      telemetryEnabled: false,
      featureMultiAgent: false,
      featureKnowledgeGraph: false,
    });
  });

  it("parses explicit values", () => {
    const config = loadEngineConfig({
      RYPER_ENV: "production",
      RYPER_LOG_LEVEL: "debug",
      RYPER_CLOUD_API_BASE_URL: "https://custom.example.com",
      RYPER_CLOUD_API_KEY: "sk-abc",
      RYPER_TELEMETRY_ENABLED: "true",
      RYPER_FEATURE_MULTI_AGENT: "1",
    });
    expect(config.environment).toBe("production");
    expect(config.logLevel).toBe("debug");
    expect(config.cloudApiBaseUrl).toBe("https://custom.example.com");
    expect(config.telemetryEnabled).toBe(true);
    expect(config.featureMultiAgent).toBe(true);
  });

  it("throws ConfigValidationError on an invalid RYPER_ENV instead of silently defaulting", () => {
    expect(() => loadEngineConfig({ RYPER_ENV: "sandbox" })).toThrow(ConfigValidationError);
  });

  it("throws ConfigValidationError on an invalid RYPER_LOG_LEVEL", () => {
    expect(() => loadEngineConfig({ RYPER_LOG_LEVEL: "verbose" })).toThrow(ConfigValidationError);
  });
});

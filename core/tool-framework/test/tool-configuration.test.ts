import { describe, expect, it } from "vitest";
import { ToolFrameworkConfigError, loadToolFrameworkConfig } from "../src/tool-configuration.js";

describe("loadToolFrameworkConfig", () => {
  it("applies defaults with no env vars set", () => {
    const config = loadToolFrameworkConfig({});
    expect(config.logLevel).toBe("info");
    expect(config.maxConcurrentInvocations).toBe(4);
    expect(config.defaultTimeoutMs).toBe(15_000);
    expect(config.memoryIntegrationEnabled).toBe(true);
  });

  it("reads overrides from env vars", () => {
    const config = loadToolFrameworkConfig({
      RYPER_TOOLS_LOG_LEVEL: "debug",
      RYPER_TOOLS_MAX_CONCURRENT_INVOCATIONS: "10",
      RYPER_TOOLS_MEMORY_INTEGRATION_ENABLED: "false",
    });
    expect(config.logLevel).toBe("debug");
    expect(config.maxConcurrentInvocations).toBe(10);
    expect(config.memoryIntegrationEnabled).toBe(false);
  });

  it("throws on an invalid log level", () => {
    expect(() => loadToolFrameworkConfig({ RYPER_TOOLS_LOG_LEVEL: "verbose" })).toThrow(
      ToolFrameworkConfigError,
    );
  });

  it("throws on a non-positive numeric override", () => {
    expect(() => loadToolFrameworkConfig({ RYPER_TOOLS_DEFAULT_TIMEOUT_MS: "0" })).toThrow(
      ToolFrameworkConfigError,
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  PlatformCapabilityConfigError,
  loadPlatformCapabilityConfig,
} from "../src/capability-configuration.js";

describe("loadPlatformCapabilityConfig", () => {
  it("applies defaults with no env vars set", () => {
    const config = loadPlatformCapabilityConfig({});
    expect(config.logLevel).toBe("info");
    expect(config.diagnosticsHistorySize).toBe(200);
    expect(config.defaultPlatform).toBe("browser");
  });

  it("reads overrides from env vars", () => {
    const config = loadPlatformCapabilityConfig({
      RYPER_PCL_LOG_LEVEL: "debug",
      RYPER_PCL_DIAGNOSTICS_HISTORY_SIZE: "50",
      RYPER_PCL_DEFAULT_PLATFORM: "windows",
    });
    expect(config.logLevel).toBe("debug");
    expect(config.diagnosticsHistorySize).toBe(50);
    expect(config.defaultPlatform).toBe("windows");
  });

  it("throws on an invalid log level", () => {
    expect(() => loadPlatformCapabilityConfig({ RYPER_PCL_LOG_LEVEL: "verbose" })).toThrow(
      PlatformCapabilityConfigError,
    );
  });

  it("throws on an invalid default platform", () => {
    expect(() => loadPlatformCapabilityConfig({ RYPER_PCL_DEFAULT_PLATFORM: "amiga" })).toThrow(
      PlatformCapabilityConfigError,
    );
  });

  it("throws on a non-positive numeric override", () => {
    expect(() => loadPlatformCapabilityConfig({ RYPER_PCL_DIAGNOSTICS_HISTORY_SIZE: "0" })).toThrow(
      PlatformCapabilityConfigError,
    );
  });
});

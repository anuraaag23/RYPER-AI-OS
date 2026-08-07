import { describe, expect, it } from "vitest";
import { InMemoryWindowsSystemApi } from "../src/reference-system-api.js";
import { createDiagnosticsManager } from "../src/diagnostics-manager.js";
import { createPermissionManager } from "../src/permission-manager.js";
import { createPerformanceMonitor } from "../src/performance-monitor.js";
import { createWindowsVersionDetector } from "../src/version-detector.js";
import { allowElevation } from "./helpers.js";

describe("DiagnosticsManager", () => {
  it("reports healthy on a supported Windows release with no recorded failures", async () => {
    const api = new InMemoryWindowsSystemApi();
    const versionDetector = createWindowsVersionDetector(api);
    const permissions = createPermissionManager();
    const performance = createPerformanceMonitor(api);
    const diagnostics = createDiagnosticsManager(api, versionDetector, permissions, performance);

    const result = await diagnostics.healthCheck();
    expect(result.status).toBe("healthy");
    expect(result.elevated).toBe(false);
  });

  it("reports unhealthy for an unsupported Windows release", async () => {
    const api = new InMemoryWindowsSystemApi({
      windowsVersion: { release: "unsupported", buildNumber: "6.1.7601", displayName: "Windows 7" },
    });
    const versionDetector = createWindowsVersionDetector(api);
    const permissions = createPermissionManager();
    const performance = createPerformanceMonitor(api);
    const diagnostics = createDiagnosticsManager(api, versionDetector, permissions, performance);

    const result = await diagnostics.healthCheck();
    expect(result.status).toBe("unhealthy");
    expect(result.details.some((d) => d.includes("unsupported"))).toBe(true);
  });

  it("records invocations and reflects elevated state", async () => {
    const api = new InMemoryWindowsSystemApi();
    const versionDetector = createWindowsVersionDetector(api);
    const permissions = createPermissionManager(allowElevation);
    await permissions.requestElevation("test");
    const performance = createPerformanceMonitor(api);
    const diagnostics = createDiagnosticsManager(api, versionDetector, permissions, performance);

    diagnostics.record({ domain: "filesystem", operation: "delete", ok: true, durationMs: 5 });
    diagnostics.record({
      domain: "filesystem",
      operation: "delete",
      ok: false,
      durationMs: 5,
      errorMessage: "denied",
    });

    expect(diagnostics.recentInvocations()).toHaveLength(2);
    expect(diagnostics.errorReport()).toHaveLength(1);

    const result = await diagnostics.healthCheck();
    expect(result.elevated).toBe(true);
    expect(result.status).toBe("degraded");
  });

  it("caps recorded invocation history at the configured size", () => {
    const api = new InMemoryWindowsSystemApi();
    const versionDetector = createWindowsVersionDetector(api);
    const permissions = createPermissionManager();
    const performance = createPerformanceMonitor(api);
    const diagnostics = createDiagnosticsManager(api, versionDetector, permissions, performance, 2);

    diagnostics.record({ domain: "a", operation: "op", ok: true, durationMs: 1 });
    diagnostics.record({ domain: "b", operation: "op", ok: true, durationMs: 1 });
    diagnostics.record({ domain: "c", operation: "op", ok: true, durationMs: 1 });

    expect(diagnostics.recentInvocations(10)).toHaveLength(2);
    expect(diagnostics.recentInvocations(10)[0]?.domain).toBe("b");
  });
});

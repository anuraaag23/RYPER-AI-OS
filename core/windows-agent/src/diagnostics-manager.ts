import { createLogger } from "@ryper/logging";
import type { PermissionManager } from "./permission-manager.js";
import type { PerformanceMonitor } from "./performance-monitor.js";
import type { WindowsVersionDetector } from "./version-detector.js";
import type { WindowsSystemApi } from "./windows-system-api.js";

const log = createLogger("windows-agent:diagnostics-manager");

export interface CapabilityInvocationLogEntry {
  readonly domain: string;
  readonly operation: string;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly errorMessage?: string;
  readonly at: string;
}

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface HealthCheckResult {
  readonly status: HealthStatus;
  readonly windowsVersion: string;
  readonly elevated: boolean;
  readonly recentFailureRate: number;
  readonly details: readonly string[];
}

/**
 * The brief's DIAGNOSTICS section in one place: structured logs (every
 * manager already logs through `@ryper/logging`; this class doesn't
 * duplicate that), a bounded invocation log this package's own
 * `WindowsAdapter` feeds on every `invoke()`, performance metrics (reads
 * `PerformanceMonitor`), error reporting, and a `healthCheck()` that
 * rolls all of it into one status.
 */
export class DiagnosticsManager {
  private readonly log: CapabilityInvocationLogEntry[] = [];

  constructor(
    private readonly systemApi: WindowsSystemApi,
    private readonly versionDetector: WindowsVersionDetector,
    private readonly permissionManager: PermissionManager,
    private readonly performanceMonitor: PerformanceMonitor,
    private readonly historySize = 500,
  ) {}

  record(entry: Omit<CapabilityInvocationLogEntry, "at">): void {
    this.log.push({ ...entry, at: new Date().toISOString() });
    if (this.log.length > this.historySize) this.log.shift();
    if (!entry.ok) {
      log.error("capability invocation failed", { ...entry });
    }
  }

  recentInvocations(limit = 50): readonly CapabilityInvocationLogEntry[] {
    return this.log.slice(-limit);
  }

  errorReport(limit = 50): readonly CapabilityInvocationLogEntry[] {
    return this.log.filter((entry) => !entry.ok).slice(-limit);
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const details: string[] = [];
    let versionOk = true;
    let versionLabel = "unknown";
    try {
      const version = await this.versionDetector.detect();
      versionLabel = version.displayName;
      if (version.release === "unsupported") {
        versionOk = false;
        details.push(`unsupported Windows release: build ${version.buildNumber}`);
      }
    } catch (err) {
      versionOk = false;
      details.push(`could not detect Windows version: ${String(err)}`);
    }

    try {
      await this.systemApi.getSystemInfo();
    } catch (err) {
      details.push(`system info unavailable: ${String(err)}`);
    }

    const recent = this.log.slice(-50);
    const failureRate =
      recent.length === 0 ? 0 : recent.filter((e) => !e.ok).length / recent.length;
    if (failureRate > 0.5)
      details.push(`high recent capability failure rate: ${(failureRate * 100).toFixed(0)}%`);

    const status: HealthStatus = !versionOk
      ? "unhealthy"
      : failureRate > 0.5
        ? "degraded"
        : failureRate > 0
          ? "degraded"
          : "healthy";

    return {
      status,
      windowsVersion: versionLabel,
      elevated: this.permissionManager.isElevated(),
      recentFailureRate: failureRate,
      details,
    };
  }

  performanceSummary() {
    return this.performanceMonitor.summary();
  }
}

export function createDiagnosticsManager(
  systemApi: WindowsSystemApi,
  versionDetector: WindowsVersionDetector,
  permissionManager: PermissionManager,
  performanceMonitor: PerformanceMonitor,
  historySize?: number,
): DiagnosticsManager {
  return new DiagnosticsManager(
    systemApi,
    versionDetector,
    permissionManager,
    performanceMonitor,
    historySize,
  );
}

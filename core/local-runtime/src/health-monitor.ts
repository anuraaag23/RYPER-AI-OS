export type HealthStatus = "healthy" | "degraded" | "unavailable";

export interface HealthSnapshot {
  readonly providerId: string;
  readonly status: HealthStatus;
  readonly consecutiveFailures: number;
  readonly lastSuccessAt?: string;
  readonly lastFailureAt?: string;
  readonly averageLatencyMs?: number;
}

interface ProviderHealthState {
  consecutiveFailures: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  latencySamples: number[];
}

/**
 * A provider transitions healthy → degraded → unavailable purely from
 * consecutive-failure counts (configurable thresholds), and any success
 * resets the streak immediately — a provider is never permanently
 * blacklisted by this monitor alone.
 */
export class RuntimeHealthMonitor {
  private readonly state = new Map<string, ProviderHealthState>();

  constructor(
    private readonly degradedThreshold = 2,
    private readonly unavailableThreshold = 5,
    private readonly latencyWindowSize = 20,
  ) {}

  private getOrInit(providerId: string): ProviderHealthState {
    let s = this.state.get(providerId);
    if (!s) {
      s = { consecutiveFailures: 0, latencySamples: [] };
      this.state.set(providerId, s);
    }
    return s;
  }

  recordSuccess(providerId: string, latencyMs?: number): void {
    const s = this.getOrInit(providerId);
    s.consecutiveFailures = 0;
    s.lastSuccessAt = new Date().toISOString();
    if (latencyMs !== undefined) {
      s.latencySamples.push(latencyMs);
      if (s.latencySamples.length > this.latencyWindowSize) s.latencySamples.shift();
    }
  }

  recordFailure(providerId: string): void {
    const s = this.getOrInit(providerId);
    s.consecutiveFailures += 1;
    s.lastFailureAt = new Date().toISOString();
  }

  getStatus(providerId: string): HealthStatus {
    const s = this.state.get(providerId);
    if (!s || s.consecutiveFailures === 0) return "healthy";
    if (s.consecutiveFailures >= this.unavailableThreshold) return "unavailable";
    if (s.consecutiveFailures >= this.degradedThreshold) return "degraded";
    return "healthy";
  }

  isUsable(providerId: string): boolean {
    return this.getStatus(providerId) !== "unavailable";
  }

  snapshot(providerId: string): HealthSnapshot {
    const s = this.state.get(providerId);
    const averageLatencyMs =
      s && s.latencySamples.length > 0
        ? s.latencySamples.reduce((sum, v) => sum + v, 0) / s.latencySamples.length
        : undefined;
    return {
      providerId,
      status: this.getStatus(providerId),
      consecutiveFailures: s?.consecutiveFailures ?? 0,
      ...(s?.lastSuccessAt !== undefined ? { lastSuccessAt: s.lastSuccessAt } : {}),
      ...(s?.lastFailureAt !== undefined ? { lastFailureAt: s.lastFailureAt } : {}),
      ...(averageLatencyMs !== undefined ? { averageLatencyMs } : {}),
    };
  }

  reset(providerId: string): void {
    this.state.delete(providerId);
  }
}

export function createRuntimeHealthMonitor(
  degradedThreshold?: number,
  unavailableThreshold?: number,
): RuntimeHealthMonitor {
  return new RuntimeHealthMonitor(degradedThreshold, unavailableThreshold);
}

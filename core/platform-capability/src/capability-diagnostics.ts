export interface CapabilityInvocationOutcome {
  readonly domain: string;
  readonly operation: string;
  readonly platform: string;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly errorMessage?: string;
}

export interface CapabilityDiagnosticEntry extends CapabilityInvocationOutcome {
  readonly at: string;
}

/** Bounded ring buffer of recent capability invocations, mirroring every prior phase's diagnostics shape. */
export class CapabilityDiagnostics {
  private readonly history: CapabilityDiagnosticEntry[] = [];

  constructor(private readonly historySize = 200) {}

  record(outcome: CapabilityInvocationOutcome): void {
    this.history.push({ ...outcome, at: new Date().toISOString() });
    if (this.history.length > this.historySize) this.history.shift();
  }

  recent(domain?: string): readonly CapabilityDiagnosticEntry[] {
    return domain ? this.history.filter((entry) => entry.domain === domain) : [...this.history];
  }
}

export function createCapabilityDiagnostics(historySize?: number): CapabilityDiagnostics {
  return new CapabilityDiagnostics(historySize);
}

export interface CapabilityMetricsSnapshot {
  readonly domain: string;
  readonly invocations: number;
  readonly failures: number;
  readonly averageDurationMs: number;
}

interface MutableCounters {
  invocations: number;
  failures: number;
  totalDurationMs: number;
}

/** O(1)-space per-domain invocation counters — separate from the bounded diagnostics history. */
export class CapabilityMetrics {
  private readonly counters = new Map<string, MutableCounters>();

  record(outcome: CapabilityInvocationOutcome): void {
    const counters = this.counters.get(outcome.domain) ?? {
      invocations: 0,
      failures: 0,
      totalDurationMs: 0,
    };
    counters.invocations += 1;
    counters.totalDurationMs += outcome.durationMs;
    if (!outcome.ok) counters.failures += 1;
    this.counters.set(outcome.domain, counters);
  }

  snapshot(domain: string): CapabilityMetricsSnapshot | undefined {
    const counters = this.counters.get(domain);
    if (!counters) return undefined;
    return {
      domain,
      invocations: counters.invocations,
      failures: counters.failures,
      averageDurationMs:
        counters.invocations === 0 ? 0 : counters.totalDurationMs / counters.invocations,
    };
  }

  allSnapshots(): readonly CapabilityMetricsSnapshot[] {
    return [...this.counters.keys()]
      .map((domain) => this.snapshot(domain))
      .filter((s): s is CapabilityMetricsSnapshot => s !== undefined);
  }
}

export function createCapabilityMetrics(): CapabilityMetrics {
  return new CapabilityMetrics();
}

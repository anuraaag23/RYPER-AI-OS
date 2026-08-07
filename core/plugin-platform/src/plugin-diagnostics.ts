import type { PluginLifecycleState } from "./types.js";

export interface PluginDiagnosticEntry {
  readonly pluginId: string;
  readonly event: string;
  readonly detail?: string;
  readonly at: string;
}

/** Bounded ring buffer of recent plugin lifecycle/runtime events, mirroring the pattern used across every prior phase. */
export class PluginDiagnostics {
  private readonly history: PluginDiagnosticEntry[] = [];

  constructor(private readonly historySize = 200) {}

  record(pluginId: string, event: string, detail?: string): void {
    this.history.push({
      pluginId,
      event,
      ...(detail ? { detail } : {}),
      at: new Date().toISOString(),
    });
    if (this.history.length > this.historySize) this.history.shift();
  }

  recent(pluginId?: string): readonly PluginDiagnosticEntry[] {
    return pluginId
      ? this.history.filter((entry) => entry.pluginId === pluginId)
      : [...this.history];
  }
}

export function createPluginDiagnostics(historySize?: number): PluginDiagnostics {
  return new PluginDiagnostics(historySize);
}

export interface PluginMetricsSnapshot {
  readonly pluginId: string;
  readonly callCount: number;
  readonly errorCount: number;
  readonly state: PluginLifecycleState | "unknown";
}

interface MutableCounters {
  callCount: number;
  errorCount: number;
}

/** O(1)-space, per-plugin call/error counters — separate from the bounded diagnostics history. */
export class PluginMetrics {
  private readonly counters = new Map<string, MutableCounters>();
  private readonly states = new Map<string, PluginLifecycleState>();

  recordCall(pluginId: string, failed = false): void {
    const counters = this.counters.get(pluginId) ?? { callCount: 0, errorCount: 0 };
    counters.callCount += 1;
    if (failed) counters.errorCount += 1;
    this.counters.set(pluginId, counters);
  }

  recordState(pluginId: string, state: PluginLifecycleState): void {
    this.states.set(pluginId, state);
  }

  snapshot(pluginId: string): PluginMetricsSnapshot | undefined {
    const counters = this.counters.get(pluginId);
    if (!counters) return undefined;
    return { pluginId, ...counters, state: this.states.get(pluginId) ?? "unknown" };
  }

  allSnapshots(): readonly PluginMetricsSnapshot[] {
    return [...this.counters.keys()]
      .map((id) => this.snapshot(id))
      .filter((s): s is PluginMetricsSnapshot => s !== undefined);
  }
}

export function createPluginMetrics(): PluginMetrics {
  return new PluginMetrics();
}

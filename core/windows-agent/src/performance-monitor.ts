import type { WindowsSystemApi } from "./windows-system-api.js";
import type { PerformanceSample } from "./types.js";

export interface PerformanceSummary {
  readonly sampleCount: number;
  readonly averageCpuPercent: number;
  readonly averageMemoryPercent: number;
  readonly peakCpuPercent: number;
}

/**
 * Samples `WindowsSystemApi.samplePerformance()` on demand (`sample()`)
 * or on an injected interval (`startSampling()`), keeping a bounded
 * history — this is what backs the brief's Diagnostics "Performance
 * metrics" requirement and, separately, the low-idle-CPU/memory
 * performance targets by making current usage observable.
 */
export class PerformanceMonitor {
  private readonly samples: PerformanceSample[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly systemApi: WindowsSystemApi,
    private readonly historySize = 500,
  ) {}

  async sample(): Promise<PerformanceSample> {
    const sample = await this.systemApi.samplePerformance();
    this.samples.push(sample);
    if (this.samples.length > this.historySize) this.samples.shift();
    return sample;
  }

  startSampling(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.sample();
    }, intervalMs);
  }

  stopSampling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  history(): readonly PerformanceSample[] {
    return [...this.samples];
  }

  summary(): PerformanceSummary {
    if (this.samples.length === 0) {
      return { sampleCount: 0, averageCpuPercent: 0, averageMemoryPercent: 0, peakCpuPercent: 0 };
    }
    const cpuSum = this.samples.reduce((sum, s) => sum + s.cpuPercent, 0);
    const memSum = this.samples.reduce((sum, s) => sum + s.memoryPercent, 0);
    const peak = this.samples.reduce((max, s) => Math.max(max, s.cpuPercent), 0);
    return {
      sampleCount: this.samples.length,
      averageCpuPercent: cpuSum / this.samples.length,
      averageMemoryPercent: memSum / this.samples.length,
      peakCpuPercent: peak,
    };
  }
}

export function createPerformanceMonitor(
  systemApi: WindowsSystemApi,
  historySize?: number,
): PerformanceMonitor {
  return new PerformanceMonitor(systemApi, historySize);
}

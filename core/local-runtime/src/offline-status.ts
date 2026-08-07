export type ConnectivityProbe = () => Promise<boolean>;

/**
 * Wraps a connectivity probe (platform shells inject a real one — a HEAD
 * request, a native reachability API) with a short cache so the runtime
 * manager can check "are we online" on every inference call without
 * re-probing the network every time.
 */
export class OfflineStatusDetector {
  private cachedResult: boolean | undefined;
  private cachedAt = 0;

  constructor(
    private readonly probe: ConnectivityProbe,
    private readonly cacheTtlMs = 5000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async isOnline(): Promise<boolean> {
    const nowMs = this.now();
    if (this.cachedResult !== undefined && nowMs - this.cachedAt < this.cacheTtlMs) {
      return this.cachedResult;
    }
    const result = await this.probe();
    this.cachedResult = result;
    this.cachedAt = nowMs;
    return result;
  }

  /** Forces the next `isOnline()` call to re-probe rather than serve a cached value. */
  invalidate(): void {
    this.cachedResult = undefined;
  }
}

export function createOfflineStatusDetector(
  probe: ConnectivityProbe,
  cacheTtlMs?: number,
): OfflineStatusDetector {
  return new OfflineStatusDetector(probe, cacheTtlMs);
}

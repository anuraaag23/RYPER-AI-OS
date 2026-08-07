import type { TelemetryClient } from "@ryper/telemetry";

export interface VoiceAnalyticsSnapshot {
  readonly wakeWordTriggers: number;
  readonly sessionsCompleted: number;
  readonly sessionsCancelled: number;
  readonly commandsHandled: number;
  readonly averageSessionMs: number;
}

/**
 * Counters are always kept locally, in memory — that part is unconditional
 * and is what "local only" means here. Whether any of it ever leaves the
 * device is entirely `@ryper/telemetry`'s existing opt-in gate: `report()`
 * calls `TelemetryClient.track()`, which is already a no-op unless the
 * user explicitly enabled telemetry (see `infra/telemetry`) — this class
 * doesn't duplicate that gate, it just uses it.
 */
export class VoiceAnalytics {
  private wakeWordTriggers = 0;
  private sessionsCompleted = 0;
  private sessionsCancelled = 0;
  private commandsHandled = 0;
  private sessionDurationsMs: number[] = [];

  constructor(private readonly telemetry?: TelemetryClient) {}

  recordWakeWordTrigger(): void {
    this.wakeWordTriggers += 1;
  }

  recordSessionCompleted(durationMs: number): void {
    this.sessionsCompleted += 1;
    this.sessionDurationsMs.push(durationMs);
  }

  recordSessionCancelled(): void {
    this.sessionsCancelled += 1;
  }

  recordCommandHandled(): void {
    this.commandsHandled += 1;
  }

  snapshot(): VoiceAnalyticsSnapshot {
    const averageSessionMs =
      this.sessionDurationsMs.length > 0
        ? this.sessionDurationsMs.reduce((sum, v) => sum + v, 0) / this.sessionDurationsMs.length
        : 0;
    return {
      wakeWordTriggers: this.wakeWordTriggers,
      sessionsCompleted: this.sessionsCompleted,
      sessionsCancelled: this.sessionsCancelled,
      commandsHandled: this.commandsHandled,
      averageSessionMs,
    };
  }

  /** No-ops unless the user has explicitly enabled telemetry — see `@ryper/telemetry`'s own opt-in gate. */
  async report(): Promise<void> {
    await this.telemetry?.track({
      name: "voice_engine.snapshot",
      properties: toTelemetryProperties(this.snapshot()),
    });
  }
}

function toTelemetryProperties(
  snapshot: VoiceAnalyticsSnapshot,
): Record<string, string | number | boolean> {
  return {
    wakeWordTriggers: snapshot.wakeWordTriggers,
    sessionsCompleted: snapshot.sessionsCompleted,
    sessionsCancelled: snapshot.sessionsCancelled,
    commandsHandled: snapshot.commandsHandled,
    averageSessionMs: snapshot.averageSessionMs,
  };
}

export function createVoiceAnalytics(telemetry?: TelemetryClient): VoiceAnalytics {
  return new VoiceAnalytics(telemetry);
}

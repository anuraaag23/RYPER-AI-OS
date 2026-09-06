export type PipelineStage =
  | "wake_word"
  | "vad"
  | "stt"
  | "intent_detection"
  | "context_retrieval"
  | "ai_engine"
  | "tts"
  | "playback";

export interface StageTiming {
  readonly stage: PipelineStage;
  readonly durationMs: number;
}

export interface DiagnosticsSnapshot {
  readonly lastStageTimings: readonly StageTiming[];
  readonly totalPipelineMs: number;
  readonly lastError?: string;
  readonly sessionCount: number;
}

/**
 * A rolling record of the most recent pipeline run's per-stage timings
 * plus the last error seen — enough for a settings screen's "voice
 * diagnostics" panel or a bug report attachment, without accumulating
 * unbounded history.
 */
export class VoiceDiagnostics {
  private lastTimings: StageTiming[] = [];
  private lastError: string | undefined;
  private sessionCount = 0;

  recordStage(stage: PipelineStage, durationMs: number): void {
    this.lastTimings.push({ stage, durationMs });
  }

  startSession(): void {
    this.lastTimings = [];
    this.lastError = undefined;
    this.sessionCount += 1;
  }

  recordError(message: string): void {
    this.lastError = message;
  }

  snapshot(): DiagnosticsSnapshot {
    return {
      lastStageTimings: this.lastTimings,
      totalPipelineMs: this.lastTimings.reduce((sum, t) => sum + t.durationMs, 0),
      ...(this.lastError !== undefined ? { lastError: this.lastError } : {}),
      sessionCount: this.sessionCount,
    };
  }
}

export function createVoiceDiagnostics(): VoiceDiagnostics {
  return new VoiceDiagnostics();
}

import { createLogger } from "@ryper/logging";
import type { EventBus } from "@ryper/event-bus";
import type { DeviceState } from "@ryper/model-router";
import { retryWithBackoff, type AIOrchestrator } from "@ryper/ai-engine";
import type { OfflineStatusDetector } from "@ryper/local-runtime";

import type { MicrophoneManager } from "./microphone-manager.js";
import type { SpeakerManager } from "./speaker-manager.js";
import type { VoiceActivityDetector } from "./voice-activity-detection.js";
import type { SpeechRecognitionRegistry } from "./stt/registry.js";
import type { SpeechSynthesisRegistry } from "./tts/registry.js";
import type { IntentDetector } from "./intent-detection.js";
import type { VoiceCommandRouter } from "./voice-command-router.js";
import type { VoiceContextManager } from "./voice-context-manager.js";
import type { VoiceSessionManager } from "./voice-session-manager.js";
import type { VoiceSettingsManager } from "./voice-settings.js";
import type { VoiceDiagnostics, PipelineStage } from "./voice-diagnostics.js";
import type { VoiceAnalytics } from "./voice-analytics.js";
import type { AudioFrame } from "./types.js";

const log = createLogger("voice-engine:pipeline");

export interface AudioPipelineManagerOptions {
  readonly sessionManager: VoiceSessionManager;
  readonly microphoneManager: MicrophoneManager;
  readonly speakerManager: SpeakerManager;
  readonly vad: VoiceActivityDetector;
  readonly sttRegistry: SpeechRecognitionRegistry;
  readonly ttsRegistry: SpeechSynthesisRegistry;
  readonly intentDetector: IntentDetector;
  readonly commandRouter: VoiceCommandRouter;
  readonly contextManager: VoiceContextManager;
  readonly orchestrator: AIOrchestrator;
  readonly settings: VoiceSettingsManager;
  readonly diagnostics: VoiceDiagnostics;
  readonly analytics: VoiceAnalytics;
  readonly offlineStatus?: OfflineStatusDetector;
  readonly eventBus?: EventBus;
  /** Consecutive silent frames after speech starts before capture auto-stops (endpointing). */
  readonly silenceEndpointFrames?: number;
}

export interface PipelineTurnResult {
  readonly transcript: string;
  readonly spokenResponse: string;
  readonly handledByCommand: boolean;
}

/**
 * Ties every other Voice Engine component together into the one pipeline
 * the brief specifies. Each stage is timed into `VoiceDiagnostics`; the
 * whole turn honors an external `AbortSignal` for cancellation, retries
 * the AI Engine call via `@ryper/ai-engine`'s own `retryWithBackoff`
 * (reused, not reimplemented), and `interrupt()` provides the barge-in
 * path (stop speaking the instant the user starts talking again).
 */
export class AudioPipelineManager {
  constructor(private readonly options: AudioPipelineManagerOptions) {}

  /** Stops whatever is currently playing and cancels the active session — the interruption/barge-in entry point. */
  interrupt(): void {
    this.options.speakerManager.interrupt();
    this.options.sessionManager.cancel();
  }

  async runTurn(
    device: DeviceState,
    signal?: AbortSignal,
    sampleRateHz = 16000,
  ): Promise<PipelineTurnResult> {
    const { sessionManager, diagnostics, analytics } = this.options;
    const session = sessionManager.getSnapshot();
    const startedAt = Date.now();
    diagnostics.startSession();

    // A real, previously-undiscovered lifecycle bug found during the
    // STT/TTS hardening pass (see docs/adr/0030): the previous turn's
    // failure/cancellation left the session parked in "error" or
    // "cancelled" as its final, correct historical state — but nothing
    // ever moved it on to "idle" afterward, and `transition("listening")`
    // below is only ever valid *from* "idle". Every voice turn after the
    // very first failure would therefore throw
    // `InvalidVoiceSessionTransitionError` immediately, permanently
    // breaking the pipeline until the whole process restarted — the
    // opposite of "subsequent turns can retry" this hardening pass
    // requires. Resetting to "idle" here, right before starting the new
    // turn, preserves the failed turn's own state as its true history
    // (any UI reading the session mid-failure still saw "error"/
    // "cancelled") while guaranteeing every new turn can actually begin.
    if (session.state === "error" || session.state === "cancelled") {
      sessionManager.transition("idle");
    }

    try {
      sessionManager.transition("listening");
      this.throwIfAborted(signal);

      const transcript = await this.timeStage("stt", () =>
        this.captureAndRecognize(sampleRateHz, signal),
      );
      this.throwIfAborted(signal);

      // Normally already "transcribing" (`markCaptureEnded()` fired once
      // VAD endpointing decided capture was done). The one real edge
      // case where it wasn't reached — capture ended on its own before
      // any trailing-silence endpoint was hit — is covered here so
      // `thinking` is always entered from a valid predecessor state.
      if (sessionManager.getSnapshot().state === "listening") {
        sessionManager.transition("transcribing");
      }
      sessionManager.transition("thinking");
      await this.options.contextManager.recordUserUtterance(session.sessionId, transcript);

      const intentMatch = this.timeStageSync("intent_detection", () =>
        this.options.intentDetector.detect(transcript),
      );

      let spokenResponse: string;
      let handledByCommand = false;

      if (intentMatch) {
        const commandResult = await this.options.commandRouter.route(intentMatch, {
          sessionId: session.sessionId,
          ...(signal ? { signal } : {}),
        });
        if (commandResult.handled) {
          // A real TTS lifecycle edge case found during the Tier 1
          // completion pass, continued (see docs/adr/0029): `??` only
          // falls back on `null`/`undefined`, not on an empty string, so
          // a command handler returning `spokenResponse: ""` previously
          // reached `speak()` with nothing to say — `chunkForSpeech("")`
          // legitimately yields zero chunks, so the turn silently
          // "completed" having spoken nothing audible at all, with no
          // error and no fallback. `.trim()` here makes a
          // whitespace-only response fall back the same way a missing
          // one already did.
          spokenResponse = commandResult.spokenResponse?.trim() || "Done.";
          handledByCommand = true;
          analytics.recordCommandHandled();
        } else {
          spokenResponse = await this.timeStage("ai_engine", () =>
            this.askAiEngine(session.sessionId, transcript, device, signal),
          );
        }
      } else {
        spokenResponse = await this.timeStage("ai_engine", () =>
          this.askAiEngine(session.sessionId, transcript, device, signal),
        );
      }

      await this.options.contextManager.recordAssistantUtterance(session.sessionId, spokenResponse);
      this.throwIfAborted(signal);

      sessionManager.transition("speaking");
      await this.timeStage("tts", () => this.speak(spokenResponse, signal));

      sessionManager.transition("idle");
      analytics.recordSessionCompleted(Date.now() - startedAt);
      void this.options.eventBus?.emit(
        "voice_engine.turn_completed",
        { sessionId: session.sessionId, transcript, handledByCommand },
        "voice-engine",
      );

      return { transcript, spokenResponse, handledByCommand };
    } catch (err) {
      diagnostics.recordError(String(err));
      // Read the *live* snapshot here, not the `session` captured before
      // this turn's transitions began — that local binding is a frozen
      // snapshot from before `transition("listening")` ever ran and was
      // therefore always "idle", which silently made this recovery
      // transition dead code (a real bug found and fixed during the
      // Tier 1 completion pass — see docs/adr/0028). Any state this
      // pipeline can be paused in mid-turn is a "busy" state with both
      // `cancelled` and `error` as valid next states (see
      // `VALID_TRANSITIONS`), so this always succeeds except when a
      // nested failure already raced it to a terminal state.
      if (sessionManager.getSnapshot().state !== "idle") {
        try {
          sessionManager.transition(signal?.aborted ? "cancelled" : "error");
        } catch {
          // Already in a terminal state from a nested failure — nothing more to do.
        }
      }
      if (signal?.aborted) {
        analytics.recordSessionCancelled();
      }
      log.error("voice pipeline turn failed", { error: String(err) });
      throw err;
    }
  }

  private async captureAndRecognize(sampleRateHz: number, signal?: AbortSignal): Promise<string> {
    const settings = this.options.settings.get();
    const isOnline = this.options.offlineStatus
      ? await this.options.offlineStatus.isOnline()
      : true;
    const provider = this.options.sttRegistry.select(settings.offlineCloudPreference, isOnline);

    const speechFrames = this.endpointedFrames(sampleRateHz, signal);
    let finalText: string | undefined;
    let lastError: string | undefined;

    for await (const event of provider.streamRecognize(speechFrames, {
      languageHint: settings.language,
      ...(signal ? { signal } : {}),
    })) {
      if (event.type === "final") finalText = event.text;
      if (event.type === "error") lastError = event.message;
    }

    // A real STT lifecycle edge case found during the Tier 1 completion
    // pass, continued (see docs/adr/0029): a provider can legitimately
    // emit a `final` event with empty/whitespace-only `text` — e.g.
    // background noise or a short non-speech sound crossed VAD's
    // endpointing threshold without containing any recognizable words.
    // That's a *different* real STT event than `finalText === undefined`
    // (no `final` event at all — a provider crash or empty audio), but
    // both represent "nothing to act on" and were previously handled
    // inconsistently: an empty transcript silently proceeded all the way
    // to the AI Engine as a real request, wasting a full round trip on
    // (and risking a nonsensical response to) a request the user never
    // actually made.
    if (finalText === undefined || finalText.trim().length === 0) {
      throw new Error(lastError ?? "speech recognition produced no result");
    }
    return finalText;
  }

  /** Wraps microphone capture with VAD-based endpointing: stops once speech has started and then gone silent for long enough. */
  private async *endpointedFrames(
    sampleRateHz: number,
    signal?: AbortSignal,
  ): AsyncGenerator<AudioFrame> {
    const silenceLimit = this.options.silenceEndpointFrames ?? 20;
    let speechStarted = false;
    let silentStreak = 0;

    this.options.vad.reset();
    try {
      for await (const frame of this.options.microphoneManager.startCapture(sampleRateHz)) {
        if (signal?.aborted) return;
        const vadResult = this.options.vad.detect(frame);
        if (vadResult.isSpeech) {
          speechStarted = true;
          silentStreak = 0;
          yield frame;
        } else if (speechStarted) {
          silentStreak += 1;
          yield frame; // include trailing silence so STT sees natural utterance boundaries
          if (silentStreak >= silenceLimit) {
            this.markCaptureEnded();
            return;
          }
        }
        // Frames before speech has started are dropped — nothing to transcribe yet.
      }
    } finally {
      this.options.microphoneManager.stopCapture();
    }
  }

  /**
   * Called the instant VAD-endpointing decides capture is done (mic
   * about to close) but before the STT provider's remaining stream
   * events (its final transcript) have necessarily arrived. Without
   * this, the session stayed in `listening` for that whole gap, which
   * left a UI's "mic is live" indicator lit after the user had already
   * stopped talking. A no-op if the signal was aborted mid-turn (the
   * catch block in `runTurn` handles that case instead) or if capture
   * ended with no speech ever detected (nothing to transcribe — the
   * empty-result error path in `captureAndRecognize` handles that).
   */
  private markCaptureEnded(): void {
    const { sessionManager } = this.options;
    if (sessionManager.getSnapshot().state === "listening") {
      sessionManager.transition("transcribing");
    }
  }

  private async askAiEngine(
    sessionId: string,
    transcript: string,
    device: DeviceState,
    signal?: AbortSignal,
  ): Promise<string> {
    const contextSnippets = await this.options.contextManager.getRelevantContext(transcript);
    const augmented =
      contextSnippets.length > 0
        ? `${transcript}\n\n[relevant context: ${contextSnippets.join("; ")}]`
        : transcript;

    const { sessionManager } = this.options;

    return retryWithBackoff(
      async () => {
        // Only true when this attempt is a retry following a
        // `recovering` transition below — the first attempt is already
        // "thinking" (set by the caller) and re-entering it would be an
        // invalid self-transition.
        if (sessionManager.getSnapshot().state === "recovering") {
          sessionManager.transition("thinking");
        }

        let text = "";
        for await (const event of this.options.orchestrator.sendMessage(sessionId, augmented, {
          device,
          ...(signal ? { signal } : {}),
        })) {
          if (event.type === "text_delta") {
            text += event.delta;
          } else if (event.type === "tool_call") {
            sessionManager.transition("tool_execution");
          } else if (event.type === "tool_result") {
            sessionManager.transition("thinking");
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }
        // `.trim()`, not just `.length`, for the same reason as the
        // command-router fallback above: a whitespace-only response
        // would otherwise reach `speak()` and be silently "spoken" as
        // nothing at all (see docs/adr/0029).
        if (text.trim().length === 0) throw new Error("AI Engine returned an empty response");
        return text;
      },
      {
        maxAttempts: 2,
        initialDelayMs: 200,
        onRetry: () => {
          // Best-effort: if a nested failure already moved the session
          // to a terminal state, there's nothing more to reflect here —
          // the outer `runTurn` catch block owns reporting the real
          // failure.
          try {
            sessionManager.transition("recovering");
          } catch {
            /* already terminal */
          }
        },
      },
    );
  }

  private async speak(text: string, signal?: AbortSignal): Promise<void> {
    const settings = this.options.settings.get();
    const isOnline = this.options.offlineStatus
      ? await this.options.offlineStatus.isOnline()
      : true;
    const chunks = this.options.ttsRegistry.synthesize(
      settings.offlineCloudPreference,
      isOnline,
      text,
      {
        voiceId: settings.voiceId,
        ...(signal ? { signal } : {}),
      },
    );
    await this.options.speakerManager.play(chunks);
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error("voice pipeline turn was cancelled");
  }

  private async timeStage<T>(stage: PipelineStage, run: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      return await run();
    } finally {
      this.options.diagnostics.recordStage(stage, Date.now() - start);
    }
  }

  private timeStageSync<T>(stage: PipelineStage, run: () => T): T {
    const start = Date.now();
    try {
      return run();
    } finally {
      this.options.diagnostics.recordStage(stage, Date.now() - start);
    }
  }
}

export function createAudioPipelineManager(
  options: AudioPipelineManagerOptions,
): AudioPipelineManager {
  return new AudioPipelineManager(options);
}

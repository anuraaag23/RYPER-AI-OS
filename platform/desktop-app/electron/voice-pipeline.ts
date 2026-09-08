import { createLogger } from "@ryper/logging";
import type { EventBus } from "@ryper/event-bus";
import type { DeviceState } from "@ryper/model-router";
import type { OfflineStatusDetector } from "@ryper/local-runtime";
import type { AIOrchestrator } from "@ryper/ai-engine";
import { retryWithBackoff } from "@ryper/ai-engine";
import type {
  AudioFrame,
  IntentDetector,
  MicrophoneManager,
  PipelineStage,
  SpeakerManager,
  SpeechRecognitionRegistry,
  SpeechSynthesisRegistry,
  VoiceActivityDetector,
  VoiceAnalytics,
  VoiceCommandRouter,
  VoiceContextManager,
  VoiceDiagnostics,
  VoiceSessionManager,
  VoiceSettingsManager,
} from "@ryper/voice-engine";
import {
  type PowerAction,
  type PowerConfirmationManager,
  tryResolvePowerConfirmation,
} from "./power-confirmation.js";
import type { ToolActivityEntry } from "./ipc-contract.js";
import { createToolActivityCollector } from "./tool-activity.js";

const log = createLogger("desktop-app:voice-pipeline");

export interface VoicePipelineOptions {
  readonly sessionManager: VoiceSessionManager;
  readonly microphoneManager: MicrophoneManager;
  readonly speakerManager: SpeakerManager;
  readonly vad: VoiceActivityDetector;
  readonly sttRegistry: SpeechRecognitionRegistry;
  readonly ttsRegistry: SpeechSynthesisRegistry;
  readonly intentDetector: IntentDetector;
  readonly commandRouter: VoiceCommandRouter;
  readonly contextManager: VoiceContextManager;
  readonly aiOrchestrator: AIOrchestrator;
  readonly settings: VoiceSettingsManager;
  readonly diagnostics: VoiceDiagnostics;
  readonly analytics: VoiceAnalytics;
  readonly offlineStatus?: OfflineStatusDetector;
  readonly eventBus?: EventBus;
  readonly silenceEndpointFrames?: number;
  /**
   * Real, two-turn power-action confirmation (PART 1-3 — see
   * `power-confirmation.ts`). Optional purely for backward
   * compatibility with any existing caller/test constructing a
   * `VoicePipeline` without one; without it, a "shutdown"/"restart"/
   * "sleep" request still registers a pending confirmation (via
   * `desktopActions`) and asks the user to confirm, but a later "yes"
   * has nothing to check against here and falls through to normal
   * processing instead of ever executing the real power action — the
   * safe failure mode, not a silent bypass.
   */
  readonly powerConfirmation?: PowerConfirmationManager;
  /** Executes a power action *only* once `powerConfirmation` has resolved a real "yes" against a real, unexpired pending request — see the interception in `runTurn()`. Never called any other way. */
  readonly executeConfirmedPowerAction?: (action: PowerAction) => Promise<{
    readonly ok: boolean;
    readonly message: string;
  }>;
  /** Whether automatic barge-in monitoring is enabled during speaker playback (can also be set via RYPER_ENABLE_BARGE_IN env var). */
  readonly enableBargeIn?: boolean;
  /** Live accessor for voice language and TTS voice preferences from settings. */
  readonly getVoiceSettings?:
    | (() => { voiceLanguage?: string | undefined; ttsVoice?: string | undefined } | undefined)
    | undefined;
}

export interface VoicePipelineTurnResult {
  readonly transcript: string;
  readonly spokenResponse: string;
  readonly handledByCommand: boolean;
  /**
   * Real tool calls made by the AI-orchestrator path during this turn
   * (empty for command-router-handled turns and power confirmations,
   * which don't go through `AIOrchestrator.sendMessage()`) — same
   * shape and redaction as the text-chat path, so a voice-triggered
   * tool call is described identically once it reaches the
   * conversation history UI. See `tool-activity.ts`.
   */
  readonly toolActivity: readonly ToolActivityEntry[];
  /**
   * Set when the user started talking while RYPER was still speaking
   * (real, automatic barge-in — see `speak()`/`monitorForBargeIn()`).
   * `transcript` is the interrupting utterance, captured and transcribed
   * during the same turn, ready for the caller to immediately start a
   * new turn with it (skip re-listening) via `runTurn()`'s
   * `presetTranscript` parameter.
   */
  readonly bargeIn?: { readonly transcript: string };
}

/**
 * The desktop app's real voice-turn orchestrator. Deliberately mirrors
 * `@ryper/voice-engine`'s `AudioPipelineManager` stage-for-stage — same
 * session-state transitions, same VAD-endpointed capture, same
 * diagnostics timing, same barge-in `interrupt()` contract — reusing
 * every one of its real sub-components directly. As of Phase 13.5 (see
 * `docs/adr/0016`), the conversational/task fallback calls a real
 * `@ryper/ai-engine` `AIOrchestrator.sendMessage()` — with real
 * multi-round tool execution against real desktop capabilities — rather
 * than `@ryper/conversation`'s `ConversationEngine` (ADR 0015's
 * original, simpler choice; `ConversationEngine` remains what the
 * desktop app's text chat window uses).
 */
export class VoicePipeline {
  constructor(private readonly options: VoicePipelineOptions) {}

  /**
   * Stops whatever is currently playing and cancels the active
   * session. This is the *explicit* stop path (e.g. the desktop app's
   * "stop" button/IPC call — see `platform/desktop-app/electron/main.ts`'s
   * `stopVoiceTurn`), which is why it lands on `cancelled` rather than
   * `interrupted`: an external, deliberate abort is a different real
   * event than the user simply starting to talk over RYPER (see
   * `handleBargeIn()`, used by `monitorForBargeIn()` for that case).
   */
  interrupt(): void {
    this.options.speakerManager.interrupt();
    this.options.sessionManager.cancel();
  }

  /**
   * The real, automatic barge-in path: called the instant
   * `monitorForBargeIn()` detects the user has started talking while
   * RYPER is still speaking. Distinct from `interrupt()` — landing on
   * `interrupted` instead of `cancelled` — because this is a normal,
   * expected conversational event (the caller immediately continues
   * the turn with the interrupting transcript via `runTurn()`'s
   * `presetTranscript`), not a user-initiated hard stop.
   */
  private handleBargeIn(): void {
    this.options.speakerManager.interrupt();
    const { sessionManager } = this.options;
    if (sessionManager.getSnapshot().state === "speaking") {
      sessionManager.transition("interrupted");
    }
  }

  async runTurn(
    device: DeviceState,
    signal?: AbortSignal,
    sampleRateHz = 16000,
    presetTranscript?: string,
  ): Promise<VoicePipelineTurnResult> {
    const { sessionManager, diagnostics, analytics } = this.options;
    const session = sessionManager.getSnapshot();
    const startedAt = Date.now();
    diagnostics.startSession();

    // Reset any non-idle state before this turn starts so transition("listening")
    // is always from "idle" and never throws InvalidVoiceSessionTransitionError.
    if (session.state !== "idle") {
      try {
        if (session.state === "error" || session.state === "cancelled" || session.state === "interrupted") {
          sessionManager.transition("idle");
        } else {
          sessionManager.transition("cancelled");
          sessionManager.transition("idle");
        }
      } catch {
        // Safe fallback if session state was already transitioning
      }
    }

    try {
      sessionManager.transition("listening");
      this.throwIfAborted(signal);

      // A barge-in interruption already captured and transcribed the
      // user's new utterance during the *previous* turn's `speak()` call
      // (see `monitorForBargeIn`) — skip re-listening for it here.
      const transcript =
        presetTranscript ??
        (await this.timeStage("stt", () => this.captureAndRecognize(sampleRateHz, signal)));
      this.throwIfAborted(signal);

      // Normally already "transcribing" (`markCaptureEnded()` fired once
      // VAD endpointing decided capture was done) — except when
      // `presetTranscript` was supplied (a barge-in continuation skips
      // capture/STT entirely) or capture ended on its own before any
      // trailing-silence endpoint was hit. Covered here so `thinking` is
      // always entered from a valid predecessor state.
      if (sessionManager.getSnapshot().state === "listening") {
        sessionManager.transition("transcribing");
      }
      sessionManager.transition("thinking");
      await this.options.contextManager.recordUserUtterance(session.sessionId, transcript);

      // Real, two-turn power-action confirmation interception (PART 1-3
      // — see power-confirmation.ts). Checked *before* normal intent
      // detection/command routing/AI orchestration, since a bare "yes"
      // must never be allowed to accidentally match some unrelated
      // intent instead of resolving the pending confirmation it's
      // actually meant to answer.
      const powerConfirmationResult = await this.tryResolvePowerConfirmation(transcript, signal);
      if (powerConfirmationResult) {
        const { spokenResponse: confirmationResponse } = powerConfirmationResult;
        await this.options.contextManager.recordAssistantUtterance(
          session.sessionId,
          confirmationResponse,
        );
        this.throwIfAborted(signal);
        sessionManager.transition("speaking");
        const bargeInTranscript = await this.timeStage("tts", () =>
          this.speak(confirmationResponse, signal, sampleRateHz),
        );
        sessionManager.transition("idle");
        analytics.recordSessionCompleted(Date.now() - startedAt);
        void this.options.eventBus?.emit(
          "voice_engine.turn_completed",
          { sessionId: session.sessionId, transcript, handledByCommand: true },
          "desktop-app",
        );
        return {
          transcript,
          spokenResponse: confirmationResponse,
          handledByCommand: true,
          toolActivity: [],
          ...(bargeInTranscript ? { bargeIn: { transcript: bargeInTranscript } } : {}),
        };
      }

      const intentMatch = this.timeStageSync("intent_detection", () =>
        this.options.intentDetector.detect(transcript),
      );

      let spokenResponse: string;
      let handledByCommand = false;
      let toolActivity: readonly ToolActivityEntry[] = [];

      if (intentMatch) {
        const commandResult = await this.options.commandRouter.route(intentMatch, {
          sessionId: session.sessionId,
          ...(signal ? { signal } : {}),
        });
        if (commandResult.handled) {
          // Same real TTS lifecycle edge-case fix as
          // `@ryper/voice-engine`'s `AudioPipelineManager` — see
          // docs/adr/0029. `.trim() || "Done."` also catches a
          // whitespace-only response, which `??` alone does not.
          spokenResponse = commandResult.spokenResponse?.trim() || "Done.";
          handledByCommand = true;
          analytics.recordCommandHandled();
        } else {
          const askResult = await this.timeStage("ai_engine", () =>
            this.askAIOrchestrator(session.sessionId, transcript, device, signal),
          );
          spokenResponse = askResult.text;
          toolActivity = askResult.toolActivity;
        }
      } else {
        const askResult = await this.timeStage("ai_engine", () =>
          this.askAIOrchestrator(session.sessionId, transcript, device, signal),
        );
        spokenResponse = askResult.text;
        toolActivity = askResult.toolActivity;
      }

      log.info("[DIAGNOSTIC] voice turn response ready", {
        transcript,
        spokenResponse,
        handledByCommand,
        toolCount: toolActivity.length,
      });

      await this.options.contextManager.recordAssistantUtterance(session.sessionId, spokenResponse);
      this.throwIfAborted(signal);

      sessionManager.transition("speaking");
      const bargeInTranscript = await this.timeStage("tts", () =>
        this.speak(spokenResponse, signal, sampleRateHz),
      );

      sessionManager.transition("idle");
      analytics.recordSessionCompleted(Date.now() - startedAt);
      void this.options.eventBus?.emit(
        "voice_engine.turn_completed",
        { sessionId: session.sessionId, transcript, handledByCommand },
        "desktop-app",
      );

      return {
        transcript,
        spokenResponse,
        handledByCommand,
        toolActivity,
        ...(bargeInTranscript ? { bargeIn: { transcript: bargeInTranscript } } : {}),
      };
    } catch (err) {
      diagnostics.recordError(String(err));
      // Read the *live* snapshot here, not the `session` captured before
      // this turn's transitions began — that local binding is a frozen
      // snapshot from before `transition("listening")` ever ran and was
      // therefore always "idle", which silently made this recovery
      // transition dead code (a real bug found and fixed during the
      // Tier 1 completion pass — see docs/adr/0028).
      if (sessionManager.getSnapshot().state !== "idle") {
        try {
          sessionManager.transition(signal?.aborted ? "cancelled" : "error");
        } catch {
          // Already in a terminal state from a nested failure — nothing more to do.
        }
      }
      if (signal?.aborted) analytics.recordSessionCancelled();
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

    const langHint = this.resolveLanguageHint();
    for await (const event of provider.streamRecognize(speechFrames, {
      ...(langHint ? { languageHint: langHint } : {}),
      ...(signal ? { signal } : {}),
    })) {
      if (event.type === "final") finalText = event.text;
      if (event.type === "error") lastError = event.message;
    }

    if (finalText === undefined || finalText.trim().length === 0) {
      // A real STT lifecycle edge case (see docs/adr/0029 and the
      // matching fix in `@ryper/voice-engine`'s `AudioPipelineManager`):
      // an empty/whitespace-only `final` transcript is treated the same
      // as "no result at all", rather than silently proceeding to the
      // AI Engine with an empty request.
      throw new Error(lastError ?? "speech recognition produced no result");
    }
    log.info("[DIAGNOSTIC] voice STT recognized speech", {
      transcript: finalText,
      providerId: provider.id,
    });
    return finalText;
  }

  private async *endpointedFrames(
    sampleRateHz: number,
    signal?: AbortSignal,
  ): AsyncGenerator<AudioFrame> {
    const silenceLimit = this.options.silenceEndpointFrames ?? 20;
    let speechStarted = false;
    let silentStreak = 0;
    let frameCount = 0;
    let speechFrameCount = 0;

    this.options.vad.reset();
    try {
      for await (const frame of this.options.microphoneManager.startCapture(sampleRateHz)) {
        if (signal?.aborted) return;
        frameCount++;
        const vadResult = this.options.vad.detect(frame);
        if (vadResult.isSpeech) {
          if (!speechStarted) {
            log.info("[DIAGNOSTIC] VAD detected speech start", {
              energy: Math.round(vadResult.energy),
              frameIndex: frameCount,
            });
          }
          speechStarted = true;
          speechFrameCount++;
          silentStreak = 0;
          yield frame;
        } else if (speechStarted) {
          silentStreak += 1;
          yield frame;
          if (silentStreak >= silenceLimit) {
            log.info("[DIAGNOSTIC] VAD endpointed silence after speech", {
              speechFrames: speechFrameCount,
              silentStreak,
              totalFrames: frameCount,
            });
            this.markCaptureEnded();
            return;
          }
        } else if (frameCount >= 50) {
          // Initial silence timeout: no speech detected after ~12s
          log.info("[DIAGNOSTIC] VAD initial silence timeout reached", { frameCount });
          return;
        }
      }
    } finally {
      this.options.microphoneManager.stopCapture();
    }
  }

  /**
   * See the identical helper in `@ryper/voice-engine`'s
   * `AudioPipelineManager` — this class deliberately mirrors it
   * stage-for-stage. `endpointedFrames()` is reused by
   * `monitorForBargeIn()` too, but that path never calls this: the
   * session is `speaking`/`interrupted` at that point, not `listening`,
   * so the guard below is a no-op there.
   */
  private markCaptureEnded(): void {
    const { sessionManager } = this.options;
    if (sessionManager.getSnapshot().state === "listening") {
      sessionManager.transition("transcribing");
    }
  }

  private async askAIOrchestrator(
    sessionId: string,
    transcript: string,
    device: DeviceState,
    signal?: AbortSignal,
  ): Promise<{ readonly text: string; readonly toolActivity: readonly ToolActivityEntry[] }> {
    this.throwIfAborted(signal);
    const contextSnippets = await this.options.contextManager.getRelevantContext(transcript);
    const augmented =
      contextSnippets.length > 0
        ? `${transcript}\n\n[relevant context: ${contextSnippets.join("; ")}]`
        : transcript;

    const { sessionManager } = this.options;
    const toolActivity = createToolActivityCollector();

    // Mirrors `@ryper/voice-engine`'s `AudioPipelineManager.askAiEngine()`
    // — this real automatic-retry path was missing here (a real
    // asymmetry between the two pipelines noted honestly in
    // `docs/adr/0028`), meaning a single transient provider hiccup
    // failed the whole turn instead of being silently retried once.
    const text = await retryWithBackoff(
      async () => {
        // Only true when this attempt is a retry following the
        // `recovering` transition below — the first attempt is already
        // "thinking" (set by the caller) and re-entering it would be an
        // invalid self-transition.
        if (sessionManager.getSnapshot().state === "recovering") {
          sessionManager.transition("thinking");
        }

        let responseText = "";
        let sawError = false;
        let errorMessage: string | undefined;
        for await (const event of this.options.aiOrchestrator.sendMessage(sessionId, augmented, {
          device,
          ...(signal ? { signal } : {}),
        })) {
          toolActivity.onEvent(event);
          if (event.type === "text_delta") responseText += event.delta;
          else if (event.type === "tool_call") {
            log.info("AI orchestrator invoking tool", { name: event.toolCall.name });
            sessionManager.transition("tool_execution");
          } else if (event.type === "tool_result") {
            if (!event.ok) {
              log.warn("tool call failed", { name: event.name, content: event.content });
            }
            sessionManager.transition("thinking");
          } else if (event.type === "error") {
            sawError = true;
            errorMessage = event.message;
            log.warn("AI orchestrator reported an error", { message: event.message });
          }
        }

        if (responseText.trim().length === 0) {
          throw new Error(
            sawError
              ? `the AI orchestrator reported an error: ${errorMessage ?? "unknown"}`
              : "the AI orchestrator returned an empty response",
          );
        }
        return responseText.trim();
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
    return { text, toolActivity: toolActivity.entries };
  }

  /**
   * Speaks `text`, while concurrently monitoring the real microphone for
   * the user starting to talk (real, automatic barge-in — not a "stop"
   * button; see `docs/adr/0018`). The moment speech is detected,
   * `interrupt()` is called immediately (stopping the real, currently-
   * playing audio via Phase 13.6's cancellation path — RYPER must not
   * continue speaking over the user), and the interrupting utterance is
   * captured and transcribed for the caller to continue the
   * conversation with, preserving context (see `runTurn()`'s
   * `presetTranscript`). Returns the interrupting transcript, or
   * `undefined` if the response was spoken to completion uninterrupted.
   */
  private async speak(
    text: string,
    signal: AbortSignal | undefined,
    sampleRateHz: number,
  ): Promise<string | undefined> {
    const settings = this.options.settings.get();
    const isOnline = this.options.offlineStatus
      ? await this.options.offlineStatus.isOnline()
      : true;
    const voiceId = this.resolveVoiceId(text);
    const chunks = this.options.ttsRegistry.synthesize(
      settings.offlineCloudPreference,
      isOnline,
      text,
      {
        voiceId,
        ...(signal ? { signal } : {}),
      },
    );

    const enableBargeIn =
      this.options.enableBargeIn ?? process.env.RYPER_ENABLE_BARGE_IN !== "false";
    if (!enableBargeIn) {
      await this.options.speakerManager.play(chunks);
      return undefined;
    }

    const bargeInState = { triggered: false };
    const monitorController = new AbortController();
    const bargeInPromise = this.monitorForBargeIn(
      sampleRateHz,
      monitorController.signal,
      bargeInState,
    );

    try {
      await this.options.speakerManager.play(chunks);
    } finally {
      // Nothing left to interrupt if the response finished on its own —
      // stop listening for barge-in so the mic doesn't stay open forever.
      if (!bargeInState.triggered) monitorController.abort();
    }

    return await bargeInPromise;
  }

  /**
   * Runs concurrently with `speak()`'s playback. Reuses `endpointedFrames`
   * exactly (same VAD, same endpointing) — its first yielded frame IS the
   * first real detected speech frame, which is the signal to interrupt
   * immediately, before waiting for the rest of the utterance or running
   * STT on it.
   */
  private async monitorForBargeIn(
    sampleRateHz: number,
    signal: AbortSignal,
    state: { triggered: boolean },
  ): Promise<string | undefined> {
    const settings = this.options.settings.get();
    const isOnline = this.options.offlineStatus
      ? await this.options.offlineStatus.isOnline()
      : true;
    const provider = this.options.sttRegistry.select(settings.offlineCloudPreference, isOnline);

    const frameSource = this.endpointedFrames(sampleRateHz, signal);
    const iterator = frameSource[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done || signal.aborted) return undefined;

    state.triggered = true;
    this.handleBargeIn();

    const rest = async function* (): AsyncGenerator<AudioFrame> {
      yield first.value;
      for (;;) {
        const next = await iterator.next();
        if (next.done) return;
        yield next.value;
      }
    };

    let finalText: string | undefined;
    const langHint = this.resolveLanguageHint();
    for await (const event of provider.streamRecognize(rest(), {
      ...(langHint ? { languageHint: langHint } : {}),
    })) {
      if (event.type === "final") finalText = event.text;
    }
    const trimmed = finalText?.trim();
    if (!trimmed || trimmed.length === 0 || /^\[.*\]$/.test(trimmed) || /^\(.*\)$/.test(trimmed)) {
      return undefined;
    }
    return trimmed;
  }

  private resolveLanguageHint(): string | undefined {
    const dynamic = this.options.getVoiceSettings?.();
    const pref = dynamic?.voiceLanguage ?? this.options.settings.get().language;
    if (!pref || pref === "auto") return "auto";
    if (pref === "hi" || pref.startsWith("hi-")) return "hi";
    if (pref === "en" || pref.startsWith("en-")) return "en";
    return pref;
  }

  private resolveVoiceId(text: string): string {
    const dynamic = this.options.getVoiceSettings?.();
    const ttsVoice = dynamic?.ttsVoice ?? "auto";
    if (ttsVoice === "hi" || ttsVoice === "hindi") return "hindi";
    if (ttsVoice === "en-IN") return "en-IN";
    if (ttsVoice === "en" || ttsVoice === "default") return "default";
    // "auto": auto-select Hindi voice if text contains Devanagari script or common Hinglish words
    if (
      /[\u0900-\u097F]/.test(text) ||
      /\b(?:hai|hain|karo|kholo|khol|diya|chalao|roko|gaana|aawaz|badhao|namaste|dhanyawad|shukriya|aap|kaise|kya|bhai|theek|accha|shuru|band)\b/i.test(text)
    ) {
      return "hindi";
    }
    return this.options.settings.get().voiceId ?? "default";
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error("voice pipeline turn was cancelled");
  }

  /**
   * Real interception for a "yes"/"no"/"cancel" response to a pending
   * power-action confirmation (PART 1-3, `power-confirmation.ts`).
   * Returns `undefined` — meaning "not a confirmation response, process
   * this transcript normally" — in every case except a genuine,
   * unambiguous match against a real, unexpired pending request:
   *
   * - No `powerConfirmation`/`executeConfirmedPowerAction` wired up at
   *   all (a caller that hasn't configured this feature).
   * - Nothing is currently pending.
   * - Something is pending, but this transcript doesn't look like a
   *   real yes/no/cancel — the pending confirmation is explicitly
   *   *cleared* here (PART 1: "do not silently interpret ambiguous
   *   language as confirmation"; an unrelated utterance means the
   *   prompt was effectively ignored, and it must not linger to be
   *   confirmed by some later, unrelated "yes").
   *
   * When it *is* a real match, this method fully owns producing the
   * spoken response (including, for "confirmed", actually executing
   * the real power action) and signals the caller to skip normal intent
   * detection/command routing/AI orchestration entirely for this turn.
   */
  private async tryResolvePowerConfirmation(
    transcript: string,
    signal?: AbortSignal,
  ): Promise<{ spokenResponse: string } | undefined> {
    const { powerConfirmation, executeConfirmedPowerAction } = this.options;
    if (!powerConfirmation || !executeConfirmedPowerAction) return undefined;
    // Delegates to the shared implementation (docs/adr/0032) that the
    // desktop app's text-chat IPC path now also uses — kept as a thin
    // wrapper here purely to adapt `{ reply }` to this pipeline's own
    // `{ spokenResponse }` naming and existing call site.
    const resolved = await tryResolvePowerConfirmation(
      transcript,
      powerConfirmation,
      executeConfirmedPowerAction,
      signal,
    );
    return resolved ? { spokenResponse: resolved.reply } : undefined;
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

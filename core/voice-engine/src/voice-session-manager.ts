import { randomUUID } from "node:crypto";
import { createLogger } from "@ryper/logging";
import type { EventBus } from "@ryper/event-bus";
import type { VoiceSessionSnapshot, VoiceSessionState } from "./types.js";

const log = createLogger("voice-engine:session-manager");

/**
 * See `VoiceSessionState`'s doc comment in `types.ts` for what each
 * state means. `cancelled` and `error` are reachable from every
 * "busy" state so an external hard-stop (`cancel()`) or an unexpected
 * failure can always be recorded, regardless of which stage of the
 * turn was in progress.
 */
const VALID_TRANSITIONS: Readonly<Record<VoiceSessionState, readonly VoiceSessionState[]>> = {
  idle: ["listening"],
  listening: ["transcribing", "cancelled", "error"],
  transcribing: ["thinking", "cancelled", "error"],
  thinking: ["tool_execution", "speaking", "recovering", "idle", "cancelled", "error"],
  tool_execution: ["thinking", "cancelled", "error"],
  recovering: ["thinking", "cancelled", "error"],
  speaking: ["idle", "interrupted", "cancelled", "error"],
  interrupted: ["idle", "listening", "cancelled", "error"],
  cancelled: ["idle"],
  error: ["idle"],
};

export class InvalidVoiceSessionTransitionError extends Error {
  constructor(from: VoiceSessionState, to: VoiceSessionState) {
    super(`cannot transition voice session from "${from}" to "${to}"`);
    this.name = "InvalidVoiceSessionTransitionError";
  }
}

export interface VoiceSessionManagerOptions {
  /** Hard ceiling on how long a session may stay in "listening" before it's force-cancelled — the security requirement that the mic is never open indefinitely. */
  readonly maxListeningMs?: number;
  readonly eventBus?: EventBus;
}

/**
 * One instance covers one active voice interaction at a time (wake word →
 * ... → speaking → idle). `state` transitions are validated against
 * `VALID_TRANSITIONS` so a bug elsewhere in the pipeline can't leave the
 * session (and therefore the microphone) in an inconsistent state.
 */
export class VoiceSessionManager {
  private session: VoiceSessionSnapshot;
  private listeningTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: VoiceSessionManagerOptions = {}) {
    this.session = this.freshSession();
  }

  private freshSession(): VoiceSessionSnapshot {
    const now = new Date().toISOString();
    return { sessionId: randomUUID(), state: "idle", startedAt: now, lastActivityAt: now };
  }

  getSnapshot(): VoiceSessionSnapshot {
    return this.session;
  }

  transition(to: VoiceSessionState): VoiceSessionSnapshot {
    const from = this.session.state;
    if (!VALID_TRANSITIONS[from].includes(to)) {
      throw new InvalidVoiceSessionTransitionError(from, to);
    }

    this.clearListeningTimer();
    if (to === "listening") {
      this.armListeningTimeout();
    }

    this.session = { ...this.session, state: to, lastActivityAt: new Date().toISOString() };
    if (to === "idle") {
      this.session = this.freshSession();
    }

    log.info("voice session transition", { from, to, sessionId: this.session.sessionId });
    void this.options.eventBus?.emit(
      "voice_engine.session_transition",
      { sessionId: this.session.sessionId, from, to },
      "voice-engine",
    );
    return this.session;
  }

  private armListeningTimeout(): void {
    const maxListeningMs = this.options.maxListeningMs ?? 15_000;
    this.listeningTimer = setTimeout(() => {
      log.warn("voice session exceeded max listening duration — force-cancelling", {
        sessionId: this.session.sessionId,
      });
      this.transition("cancelled");
    }, maxListeningMs);
  }

  private clearListeningTimer(): void {
    if (this.listeningTimer) {
      clearTimeout(this.listeningTimer);
      this.listeningTimer = undefined;
    }
  }

  cancel(): VoiceSessionSnapshot {
    if (this.session.state === "idle") return this.session;
    return this.transition("cancelled");
  }

  dispose(): void {
    this.clearListeningTimer();
  }
}

export function createVoiceSessionManager(
  options?: VoiceSessionManagerOptions,
): VoiceSessionManager {
  return new VoiceSessionManager(options);
}

import { createLogger } from "@ryper/logging";

const log = createLogger("desktop-app:power-confirmation");

/**
 * Real, session-scoped confirmation UX for power actions (PARTs 1-3 of
 * the brief). This is deliberately a *separate concern* from
 * `@ryper/windows-agent`'s `DestructiveActionGate` — that gate answers
 * "does a real, UI-backed confirmer authorize this exact call right
 * now" (a synchronous, single-call decision the existing security
 * architecture already enforces, unchanged); this class answers "has
 * the user, across two separate voice turns, actually said yes to
 * this specific pending request." Both gates apply, independently —
 * saying "yes" here does not bypass `DestructiveActionGate`; it's what
 * makes a *second* real call into the capability layer happen at all,
 * which then still goes through the existing, unchanged authorization
 * chain. Neither gate is a substitute for the other.
 */
export type PowerAction = "shutdown" | "restart" | "sleep";
export type PowerConfirmationOutcome =
  "confirmed" | "denied" | "cancelled" | "expired" | "not_pending";

export interface PendingPowerConfirmation {
  readonly id: string;
  readonly sessionId: string;
  readonly action: PowerAction;
  readonly createdAt: number;
  readonly expiresAt: number;
}

const DEFAULT_TTL_MS = 30_000;

/**
 * This is a single-user desktop app — there is one real human on the
 * other end of the microphone. A power-action request can be
 * originated by either integration surface (`VoiceCommandRouter`'s
 * fast path, or `AIOrchestrator`'s tool-calling loop), which use
 * *different* `actorId`s for capability-auditing purposes
 * ("voice-session" vs "ai-orchestrator") — but the confirmation itself
 * is conceptually about "did the person say yes," not "which internal
 * code path happened to notice the request," so it's tracked under
 * one fixed, stable key regardless of which surface registered it.
 * `VoicePipeline.runTurn()`'s pending-confirmation interception checks
 * this same fixed key on every turn, before it even knows which
 * surface *would* handle a non-confirmation utterance.
 */
export const POWER_CONFIRMATION_SESSION_KEY = "voice-user";

export class PowerConfirmationManager {
  private readonly pending = new Map<string, PendingPowerConfirmation>();
  private counter = 0;

  constructor(
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Registers a new pending confirmation for `sessionId`, replacing any
   * previous one (PART 3's "duplicate confirmation" case — only the
   * most recent request is ever live; an old one can no longer be
   * confirmed by a later "yes" once superseded). Each request gets a
   * fresh, unique id — PART 3's "use a unique request/confirmation
   * identifier" — so a stale reference can never be mistaken for the
   * current one, even if a caller somehow held on to one.
   */
  request(sessionId: string, action: PowerAction): PendingPowerConfirmation {
    this.counter += 1;
    const record: PendingPowerConfirmation = {
      id: `pwr-confirm-${sessionId}-${this.now()}-${this.counter}`,
      sessionId,
      action,
      createdAt: this.now(),
      expiresAt: this.now() + this.ttlMs,
    };
    this.pending.set(sessionId, record);
    log.info("power confirmation requested", { sessionId, action, id: record.id });
    return record;
  }

  /** True only if a real, unexpired confirmation is currently pending for this session — expired entries are lazily cleared here, not left dangling. */
  hasPending(sessionId: string): boolean {
    const record = this.pending.get(sessionId);
    if (!record) return false;
    if (this.now() > record.expiresAt) {
      this.pending.delete(sessionId);
      log.info("pending power confirmation expired (lazily cleared)", {
        sessionId,
        action: record.action,
      });
      return false;
    }
    return true;
  }

  peek(sessionId: string): PendingPowerConfirmation | undefined {
    return this.hasPending(sessionId) ? this.pending.get(sessionId) : undefined;
  }

  /**
   * Resolves (and always clears) the current pending confirmation for a
   * session. Returns `"not_pending"` if there was none to resolve —
   * PART 1's requirement that a bare "yes" with no active request
   * doesn't silently authorize anything. Returns `"expired"` if the
   * record had already timed out (PART 3) — the caller must not treat
   * this as confirmation regardless of `decision`.
   */
  resolve(
    sessionId: string,
    decision: "confirmed" | "denied" | "cancelled",
  ): { outcome: PowerConfirmationOutcome; action?: PowerAction } {
    const record = this.pending.get(sessionId);
    if (!record) return { outcome: "not_pending" };
    this.pending.delete(sessionId);
    if (this.now() > record.expiresAt) {
      log.info("power confirmation resolved but had already expired", {
        sessionId,
        action: record.action,
      });
      return { outcome: "expired", action: record.action };
    }
    log.info("power confirmation resolved", { sessionId, action: record.action, decision });
    return { outcome: decision, action: record.action };
  }

  /**
   * Explicitly invalidates any pending confirmation for a session —
   * used when the user's next utterance is unrelated (PART 1: "do not
   * silently interpret ambiguous language as confirmation" — an
   * unrelated command means the confirmation prompt was effectively
   * ignored, not agreed to, so it must not linger to be accidentally
   * confirmed by a later, unrelated "yes"), and when a session
   * ends/resets (PART 3: "application shutdown/restart while
   * confirmation is pending", PART 11: session-scoped lifetime).
   */
  clear(sessionId: string): void {
    if (this.pending.delete(sessionId)) {
      log.info("pending power confirmation cleared (superseded by unrelated activity)", {
        sessionId,
      });
    }
  }

  clearAll(): void {
    this.pending.clear();
  }
}

export function createPowerConfirmationManager(
  ttlMs?: number,
  now?: () => number,
): PowerConfirmationManager {
  return new PowerConfirmationManager(ttlMs, now);
}

// ---- Real, conservative yes/no/cancel matching ----
// Deliberately anchored, deliberately small. A generic "does this
// transcript contain the word yes anywhere" match would risk treating
// an unrelated sentence that happens to contain "yes" as confirmation
// — PART 1's explicit "do not silently interpret ambiguous language as
// confirmation" requirement. Every pattern here matches only a short,
// unambiguous, whole-utterance response.

const CONFIRM_PATTERNS: readonly RegExp[] = [
  /^yes$/i,
  /^yes,? do it$/i,
  /^yeah$/i,
  /^yep$/i,
  /^yup$/i,
  /^confirm(ed)?$/i,
  /^do it$/i,
  /^go ahead$/i,
  /^sure,? do it$/i,
  /^okay,? do it$/i,
  /^ok,? do it$/i,
  // Hindi & Hinglish affirmative confirmations
  /^haan$/i,
  /^ha$/i,
  /^haanji$/i,
  /^haan,? (?:kar do|kardo)$/i,
  /^kar do$/i,
  /^kardo$/i,
  /^theek hai$/i,
  /^bilkul$/i,
  /^हाँ$/i,
  /^हां$/i,
  /^कर दो$/i,
  /^ठीक है$/i,
];

const DENY_PATTERNS: readonly RegExp[] = [
  /^no$/i,
  /^nope$/i,
  /^nah$/i,
  /^don'?t do that$/i,
  /^do not do that$/i,
  /^negative$/i,
  /^deny$/i,
  // Hindi & Hinglish negative/denial responses
  /^nahi$/i,
  /^nahin$/i,
  /^na$/i,
  /^mat karo$/i,
  /^नहीं$/i,
  /^ना$/i,
  /^मत करो$/i,
];

const CANCEL_PATTERNS: readonly RegExp[] = [
  /^cancel$/i,
  /^never ?mind$/i,
  /^forget it$/i,
  /^stop$/i,
  /^abort$/i,
  // Hindi & Hinglish cancellation responses
  /^ruko$/i,
  /^cancel karo$/i,
  /^रद्‍द करो$/i,
  /^रुको$/i,
];

/**
 * Classifies a transcript as a confirm/deny/cancel response, or
 * `undefined` if it isn't one of the narrow set of unambiguous
 * responses this recognizes — an `undefined` result must never be
 * treated as confirmation (see `PowerConfirmationManager.clear`'s doc
 * comment for what the caller should do instead: treat it as an
 * unrelated utterance and drop the pending confirmation, not guess).
 */
export function matchConfirmationResponse(
  transcript: string,
): "confirmed" | "denied" | "cancelled" | undefined {
  const normalized = transcript
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");
  if (CANCEL_PATTERNS.some((p) => p.test(normalized))) return "cancelled";
  if (DENY_PATTERNS.some((p) => p.test(normalized))) return "denied";
  if (CONFIRM_PATTERNS.some((p) => p.test(normalized))) return "confirmed";
  return undefined;
}

export const POWER_ACTION_PROMPTS: Readonly<Record<PowerAction, string>> = {
  shutdown: "Are you sure you want to shut down your PC? Say yes to confirm, or no to cancel.",
  restart:
    "Are you sure you want to restart your PC? This will close all open applications. Say yes to confirm, or no to cancel.",
  sleep: "Put your PC to sleep? Say yes to confirm, or no to cancel.",
};

export const POWER_ACTION_SUCCESS_MESSAGES: Readonly<Record<PowerAction, string>> = {
  shutdown: "Shutting down.",
  restart: "Restarting.",
  sleep: "Going to sleep.",
};

export const POWER_ACTION_DENIED_MESSAGES: Readonly<Record<PowerAction, string>> = {
  shutdown: "Okay, cancelling the shutdown.",
  restart: "Okay, cancelling the restart.",
  sleep: "Okay, cancelling.",
};

export const POWER_ACTION_CANCELLED_MESSAGES: Readonly<Record<PowerAction, string>> = {
  shutdown: "Shutdown cancelled.",
  restart: "Restart cancelled.",
  sleep: "Cancelled.",
};

/**
 * The single, shared real interception for a "yes"/"no"/"cancel"
 * response to a pending power-action confirmation (PART 1-3 of the
 * original brief; see docs/adr/0031). Originally lived only inside
 * `VoicePipeline.runTurn()`; extracted here (docs/adr/0032) once text
 * chat also needed the exact same check *before* routing a message to
 * the real `AIOrchestrator` — a bare "yes" typed in the chat box must
 * resolve a pending "are you sure you want to shut down?" exactly the
 * same way a spoken "yes" already does, not be treated as an ordinary
 * new message the model has to guess the meaning of.
 *
 * Returns `undefined` in every case except a genuine, unambiguous
 * match against a real, unexpired pending request — meaning "not a
 * confirmation response, process this message normally." See the
 * inline comments for exactly which cases those are.
 */
export async function tryResolvePowerConfirmation(
  message: string,
  powerConfirmation: PowerConfirmationManager,
  executeConfirmedPowerAction: (
    action: PowerAction,
  ) => Promise<{ readonly ok: boolean; readonly message: string }>,
  signal?: AbortSignal,
): Promise<{ reply: string } | undefined> {
  if (!powerConfirmation.hasPending(POWER_CONFIRMATION_SESSION_KEY)) return undefined;

  const decision = matchConfirmationResponse(message);
  if (!decision) {
    // PART 1: "do not silently interpret ambiguous language as
    // confirmation" — an unrelated message means the prompt was
    // effectively ignored, and it must not linger to be confirmed by
    // some later, unrelated "yes".
    powerConfirmation.clear(POWER_CONFIRMATION_SESSION_KEY);
    return undefined;
  }

  const { outcome, action } = powerConfirmation.resolve(POWER_CONFIRMATION_SESSION_KEY, decision);
  if (outcome === "not_pending") return undefined; // Raced with expiry between the two checks above.
  if (!action) return undefined;

  if (outcome === "expired") {
    return {
      reply:
        "That confirmation has expired, so I didn't do anything. Please ask again if you still want to.",
    };
  }
  if (outcome === "denied") {
    return { reply: POWER_ACTION_DENIED_MESSAGES[action] };
  }
  if (outcome === "cancelled") {
    return { reply: POWER_ACTION_CANCELLED_MESSAGES[action] };
  }

  // outcome === "confirmed" — the one path that actually executes the
  // real power action, still through the full, unchanged
  // CapabilityManager -> PowerManager -> DestructiveActionGate chain.
  if (signal?.aborted) throw new Error("cancelled");
  try {
    const result = await executeConfirmedPowerAction(action);
    return { reply: result.message };
  } catch (err) {
    return { reply: err instanceof Error ? err.message : `Couldn't complete that: ${String(err)}` };
  }
}

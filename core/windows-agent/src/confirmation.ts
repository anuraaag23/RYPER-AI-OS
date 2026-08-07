import { createLogger } from "@ryper/logging";

const log = createLogger("windows-agent:confirmation");

export interface DestructiveActionRequest {
  readonly action: string;
  readonly target: string;
  readonly reason: string;
}

/**
 * The single hook every destructive Windows operation (deleting a file,
 * killing a critical process, stopping a critical service, writing an
 * unauthorized registry value, ...) goes through before it runs. Mirrors
 * `@ryper/security`'s `ConsentPrompt` pattern exactly, but is
 * deliberately a *separate* concept: `ConsentPrompt`/`CapabilityBroker`
 * answer "is this actor allowed to use this capability at all" (an
 * app-level grant, checked once by `CapabilityManager.invoke()` before
 * the adapter is even reached); `DestructiveActionConfirmer` answers
 * "should *this specific* action really happen right now" (a per-call
 * UX confirmation, e.g. "Delete C:\Users\...\report.docx?"), which the
 * brief requires independently of whether the actor already holds the
 * `filesystem.write` capability grant.
 */
export type DestructiveActionConfirmer = (request: DestructiveActionRequest) => Promise<boolean>;

/**
 * The safe default: refuses every destructive action. A platform shell
 * must inject a real UI-backed confirmer (a dialog, a voice prompt, ...)
 * to allow destructive operations at all — "never elevate privileges
 * automatically, prompt the user before any destructive action" means
 * silence (no injected confirmer) has to mean "no," not "yes."
 */
export const denyAllConfirmer: DestructiveActionConfirmer = async (request) => {
  log.warn("destructive action denied: no confirmer configured", { ...request });
  return false;
};

export class DestructiveActionDeniedError extends Error {}

export class DestructiveActionGate {
  constructor(private readonly confirmer: DestructiveActionConfirmer = denyAllConfirmer) {}

  async require(request: DestructiveActionRequest): Promise<void> {
    const confirmed = await this.confirmer(request);
    log.info("destructive action confirmation", { ...request, confirmed });
    if (!confirmed) {
      throw new DestructiveActionDeniedError(
        `"${request.action}" on "${request.target}" was not confirmed: ${request.reason}`,
      );
    }
  }
}

export function createDestructiveActionGate(
  confirmer?: DestructiveActionConfirmer,
): DestructiveActionGate {
  return new DestructiveActionGate(confirmer);
}

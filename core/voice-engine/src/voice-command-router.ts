import { createLogger } from "@ryper/logging";
import type { VoiceCommandMatch, VoiceCommandResult } from "./types.js";

const log = createLogger("voice-engine:command-router");

export interface VoiceCommandContext {
  readonly sessionId: string;
  readonly signal?: AbortSignal;
}

export interface VoiceCommandHandler {
  readonly intent: string;
  handle(
    match: VoiceCommandMatch,
    context: VoiceCommandContext,
  ): Promise<VoiceCommandResult> | VoiceCommandResult;
}

/**
 * A handler for a downstream module that doesn't exist yet. It satisfies
 * `VoiceCommandHandler` so the command's *interface* is real and callable
 * today — exactly the brief's "commands should call interfaces only if
 * downstream modules are not yet implemented" — and responds with an
 * honest, spoken "not available yet" rather than silently failing or
 * throwing.
 */
export function notYetImplementedHandler(
  intent: string,
  friendlyName: string,
): VoiceCommandHandler {
  return {
    intent,
    handle: (): VoiceCommandResult => ({
      handled: true,
      spokenResponse: `${friendlyName} isn't available yet, but I've got the request noted.`,
    }),
  };
}

/**
 * Routes a detected intent to its registered handler. An intent with no
 * registered handler at all (as opposed to one registered via
 * `notYetImplementedHandler`) returns `handled: false` so the pipeline
 * falls through to the Core AI Engine for a conversational response.
 */
export class VoiceCommandRouter {
  private readonly handlers = new Map<string, VoiceCommandHandler>();

  register(handler: VoiceCommandHandler): void {
    if (this.handlers.has(handler.intent)) {
      throw new Error(`a handler for intent "${handler.intent}" is already registered`);
    }
    this.handlers.set(handler.intent, handler);
  }

  isRegistered(intent: string): boolean {
    return this.handlers.has(intent);
  }

  async route(match: VoiceCommandMatch, context: VoiceCommandContext): Promise<VoiceCommandResult> {
    const handler = this.handlers.get(match.intent);
    if (!handler) {
      return { handled: false };
    }
    try {
      return await handler.handle(match, context);
    } catch (err) {
      log.error("command handler threw", { intent: match.intent, error: String(err) });
      return { handled: true, spokenResponse: "Something went wrong running that command." };
    }
  }

  listIntents(): readonly string[] {
    return [...this.handlers.keys()];
  }
}

export function createVoiceCommandRouter(): VoiceCommandRouter {
  return new VoiceCommandRouter();
}

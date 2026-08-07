import { CapabilityBroker } from "@ryper/security";
import type { ConsentPrompt } from "@ryper/security";
import type { ToolExecutionContext } from "@ryper/tool-framework";
import type { DestructiveActionConfirmer } from "../src/confirmation.js";
import type { ElevationPrompt } from "../src/permission-manager.js";

export function buildCapabilityBroker(
  promptForConsent: ConsentPrompt = () => true,
): CapabilityBroker {
  return new CapabilityBroker(promptForConsent);
}

export const allowAllConfirmer: DestructiveActionConfirmer = async () => true;
export const denyConfirmer: DestructiveActionConfirmer = async () => false;

export const allowElevation: ElevationPrompt = async () => true;
export const denyElevation: ElevationPrompt = async () => false;

export function buildToolContext(
  overrides: Partial<ToolExecutionContext> = {},
): ToolExecutionContext {
  return {
    invocationId: "invocation-1",
    actorId: "actor-1",
    sessionId: "session-1",
    platform: "windows",
    ...overrides,
  };
}

import type { CapabilityBroker } from "@ryper/security";
import {
  createCapabilityManager,
  createCapabilityTool,
  type CapabilityManager,
} from "@ryper/platform-capability";
import type { ToolDefinition, ToolSpec } from "@ryper/tool-framework";
import { registerWindowsCapabilityDescriptors } from "./capability-descriptors.js";
import type { WindowsAdapter } from "./windows-adapter.js";
import { createWindowsAdapter, type WindowsAdapterOptions } from "./windows-adapter.js";

export interface BootstrapWindowsPlatformAgentOptions {
  readonly broker: CapabilityBroker;
  readonly adapterOptions?: WindowsAdapterOptions;
  readonly platformDetector?: () => "windows";
}

export interface WindowsPlatformAgentBundle {
  readonly adapter: WindowsAdapter;
  readonly capabilityManager: CapabilityManager;
}

/**
 * The one-call path a platform shell (or this package's own tests) uses
 * to stand up a fully wired Windows Platform Agent: build the
 * `WindowsAdapter` (detecting the Windows version first), register it
 * plus every descriptor in `capability-descriptors.ts` with a real
 * `CapabilityManager`, and hand both back. Nothing here is required —
 * every piece can be assembled by hand (see `windows-adapter.ts` and
 * `capability-descriptors.ts` directly) — but this is the shape every
 * test in `test/integration.test.ts` builds on.
 */
export async function bootstrapWindowsPlatformAgent(
  options: BootstrapWindowsPlatformAgentOptions,
): Promise<WindowsPlatformAgentBundle> {
  const adapter = await createWindowsAdapter(options.adapterOptions);
  const capabilityManager = createCapabilityManager({
    broker: options.broker,
    platformDetector: options.platformDetector ?? (() => "windows"),
  });
  registerWindowsCapabilityDescriptors(capabilityManager);
  capabilityManager.registerAdapter(adapter);
  return { adapter, capabilityManager };
}

/**
 * A worked example of the brief's Tool Framework integration
 * requirement — "prove one capability works wrapped via
 * `createCapabilityTool`" — for the `application_control.launch`
 * operation. A platform shell can call `manager.registerTool(...)` with
 * this (or any other domain/operation pair) to make it invokable through
 * `@ryper/tool-framework`'s `ToolManager`.
 */
export function createLaunchApplicationTool(capabilityManager: CapabilityManager): ToolDefinition {
  const spec: ToolSpec = {
    id: "windows.application.launch",
    name: "Launch Windows Application",
    description: "Launches an installed Windows application by its application id.",
    category: "application",
    version: "0.1.0",
    author: "@ryper/windows-agent",
    capabilities: [],
    permissions: [],
    inputSchema: {
      type: "object",
      properties: { appId: { type: "string", description: "The installed application's id" } },
      required: ["appId"],
    },
    outputSchema: { type: "object" },
    examples: [
      {
        description: "Launch Notepad",
        input: { appId: "microsoft.windows.notepad" },
      },
    ],
    errorCodes: [{ code: "NOT_FOUND", description: "no installed application with the given id" }],
    executionCost: "low",
    timeoutMs: 10_000,
    cancellationSupport: false,
    streamingSupport: false,
  };
  return createCapabilityTool(capabilityManager, "application_control", "launch", spec);
}

import type { PlatformSupportSource, SupportedPlatform, TaskType } from "@ryper/planner";
import type { CapabilityManager } from "./capability-manager.js";
import type { CapabilityDomain } from "./types.js";
import { toPlatformId } from "./types.js";

/**
 * Maps `@ryper/planner`'s closed `TaskType` union to this layer's open
 * `CapabilityDomain` set. Partial by nature (some task types, like
 * `"note"`, map to a broad domain like `"storage"` rather than something
 * task-specific) — the map only needs to be good enough for the Planner
 * to ask "can the active adapter do this kind of thing," not perfectly
 * granular.
 */
export const TASK_TYPE_TO_DOMAIN: Readonly<Record<TaskType, CapabilityDomain>> = {
  application: "application_control",
  browser: "browser_control",
  document: "filesystem",
  image: "media_playback",
  video: "media_playback",
  audio: "audio",
  file: "filesystem",
  calendar: "calendar",
  note: "storage",
  message: "messages",
  call: "phone_calls",
  camera: "camera",
  smart_home: "smart_home",
  automation: "automation",
  ai: "ai_providers",
  memory: "storage",
  plugin: "automation",
  cloud: "cloud_storage",
  platform: "device_information",
};

/**
 * Builds a `PlatformSupportSource` (the injectable hook Phase 7's
 * `CapabilityResolver` now accepts — see `docs/adr/0006`) backed by a real
 * `CapabilityManager` instead of the Planner's static built-in table.
 * This is how "the Planner must query the Platform Capability Layer
 * before generating executable plans" becomes real: pass this into
 * `new CapabilityResolver(createPlannerCapabilitySource(manager))` and
 * hand that resolver to `PlannerEngine`.
 */
export function createPlannerCapabilitySource(manager: CapabilityManager): PlatformSupportSource {
  return (taskType: TaskType, platform: SupportedPlatform): boolean => {
    const domain = TASK_TYPE_TO_DOMAIN[taskType];
    return manager.resolve(domain, toPlatformId(platform)).supported;
  };
}

import type { CapabilityBroker, Capability } from "@ryper/security";
import { createLogger } from "@ryper/logging";
import type {
  CapabilityResolution,
  PlatformCapabilitySnapshot,
  SupportedPlatform,
  TaskNode,
  TaskType,
} from "./types.js";

const log = createLogger("planner:capability");

/**
 * `@ryper/security`'s `Capability` union is intentionally small and
 * platform-agnostic. Not every `TaskType` needs a gated capability (e.g.
 * launching a note-taking UI needs none), so this map is partial by
 * design — task types absent from it are capability-free as far as the
 * broker is concerned, which is an honest reflection of today's
 * `Capability` union rather than an oversight. Extending `Capability`
 * itself belongs to `@ryper/security`, not this package.
 */
export const taskTypeToCapability: Readonly<Partial<Record<TaskType, Capability>>> = {
  file: "filesystem.read",
  document: "filesystem.read",
  browser: "network",
  cloud: "network",
  camera: "camera",
  audio: "microphone",
  automation: "automation.execute",
};

/**
 * Every platform agent that exists today or is planned. A task type
 * missing from a platform's set means the *current build* of that agent
 * doesn't support it yet — not that it's architecturally impossible — so
 * the resolver's job is to degrade gracefully, never to hard-fail.
 */
const platformSupport: Readonly<Record<SupportedPlatform, ReadonlySet<TaskType>>> = {
  windows: new Set<TaskType>([
    "application",
    "browser",
    "document",
    "image",
    "video",
    "audio",
    "file",
    "calendar",
    "note",
    "message",
    "smart_home",
    "automation",
    "ai",
    "memory",
    "plugin",
    "cloud",
    "platform",
  ]),
  macos: new Set<TaskType>([
    "application",
    "browser",
    "document",
    "image",
    "video",
    "audio",
    "file",
    "calendar",
    "note",
    "message",
    "call",
    "smart_home",
    "automation",
    "ai",
    "memory",
    "plugin",
    "cloud",
    "platform",
  ]),
  linux: new Set<TaskType>([
    "application",
    "browser",
    "document",
    "image",
    "video",
    "audio",
    "file",
    "calendar",
    "note",
    "automation",
    "ai",
    "memory",
    "plugin",
    "cloud",
    "platform",
  ]),
  android: new Set<TaskType>([
    "application",
    "browser",
    "document",
    "image",
    "video",
    "audio",
    "file",
    "calendar",
    "note",
    "message",
    "call",
    "camera",
    "smart_home",
    "automation",
    "ai",
    "memory",
    "plugin",
    "cloud",
    "platform",
  ]),
  ios: new Set<TaskType>([
    "application",
    "browser",
    "document",
    "image",
    "video",
    "audio",
    "file",
    "calendar",
    "note",
    "message",
    "call",
    "camera",
    "ai",
    "memory",
    "plugin",
    "cloud",
    "platform",
  ]),
  web: new Set<TaskType>([
    "browser",
    "document",
    "image",
    "audio",
    "note",
    "ai",
    "memory",
    "plugin",
    "cloud",
    "platform",
  ]),
};

export function snapshotPlatformCapabilities(
  platform: SupportedPlatform,
): PlatformCapabilitySnapshot {
  return { platform, supportedTaskTypes: platformSupport[platform] };
}

/**
 * Decides, per task, whether the current platform can run it and what
 * capability grant it would need. Unsupported task types get a graceful
 * textual alternative rather than causing the plan to fail outright.
 */
export type PlatformSupportSource = (taskType: TaskType, platform: SupportedPlatform) => boolean;

/**
 * Decides, per task, whether the current platform can run it and what
 * capability grant it would need. Unsupported task types get a graceful
 * textual alternative rather than causing the plan to fail outright.
 *
 * By default, "supported" comes from the static `platformSupport` table
 * above. A caller (e.g. `@ryper/platform-capability`'s
 * `createPlannerCapabilitySource`) may instead inject a
 * `PlatformSupportSource` backed by a real, dynamically-queried platform
 * capability layer — this is purely additive: every existing
 * `new CapabilityResolver()` call keeps its exact current behavior.
 */
export class CapabilityResolver {
  constructor(private readonly supportSource?: PlatformSupportSource) {}

  resolve(taskType: TaskType, platform: SupportedPlatform): CapabilityResolution {
    const supported = this.supportSource
      ? this.supportSource(taskType, platform)
      : snapshotPlatformCapabilities(platform).supportedTaskTypes.has(taskType);
    const requiredCapability = taskTypeToCapability[taskType];
    if (supported) {
      return { taskType, supported, ...(requiredCapability ? { requiredCapability } : {}) };
    }
    return {
      taskType,
      supported: false,
      ...(requiredCapability ? { requiredCapability } : {}),
      alternative: `"${taskType}" tasks aren't available on ${platform} yet; the plan will surface a conversational fallback for this step instead of executing it.`,
    };
  }

  resolveAll(
    taskTypes: readonly TaskType[],
    platform: SupportedPlatform,
  ): readonly CapabilityResolution[] {
    return taskTypes.map((taskType) => this.resolve(taskType, platform));
  }
}

export function createCapabilityResolver(
  supportSource?: PlatformSupportSource,
): CapabilityResolver {
  return new CapabilityResolver(supportSource);
}

export interface PermissionCheckResult {
  readonly taskId: string;
  readonly capability: Capability;
  readonly granted: boolean;
}

/**
 * Requests (or checks) grants for every capability-gated task in a plan
 * before execution starts, so a downstream platform agent never has to
 * discover a missing permission mid-run. Reuses `@ryper/security`'s
 * `CapabilityBroker` — this module never re-implements consent logic.
 */
export class PermissionValidator {
  constructor(private readonly broker: CapabilityBroker) {}

  async validate(
    tasks: readonly TaskNode[],
    actorId: string,
    justification = "agent-planner execution plan",
  ): Promise<readonly PermissionCheckResult[]> {
    const results: PermissionCheckResult[] = [];
    for (const task of tasks) {
      if (!task.requiredCapability) continue;
      const grant = await this.broker.requestCapability({
        actorId,
        capability: task.requiredCapability,
        justification,
      });
      const granted = grant.decision === "granted";
      if (!granted) {
        log.warn("capability not granted for planned task", {
          taskId: task.id,
          capability: task.requiredCapability,
        });
      }
      results.push({ taskId: task.id, capability: task.requiredCapability, granted });
    }
    return results;
  }
}

export function createPermissionValidator(broker: CapabilityBroker): PermissionValidator {
  return new PermissionValidator(broker);
}

import type { EventBus, RyperEvent } from "@ryper/event-bus";
import type { CapabilityBroker, Capability } from "@ryper/security";
import { createLogger } from "@ryper/logging";

const log = createLogger("automation");

export interface AutomationAction {
  readonly name: string;
  readonly requiredCapability?: Capability;
  run(event: RyperEvent): Promise<void> | void;
}

export interface AutomationRule {
  readonly id: string;
  readonly triggerType: string;
  readonly condition?: (event: RyperEvent) => boolean;
  readonly actions: readonly AutomationAction[];
}

/**
 * Rules never call OS APIs directly — every action that needs a capability
 * is checked against the CapabilityBroker before it runs, so an automation
 * rule can't silently gain more access than the user granted.
 */
export class AutomationEngine {
  private readonly rules = new Map<string, AutomationRule>();
  private readonly unsubscribes: Array<() => void> = [];

  constructor(
    private readonly eventBus: EventBus,
    private readonly broker: CapabilityBroker,
    private readonly actorId = "automation-engine",
  ) {}

  registerRule(rule: AutomationRule): void {
    this.rules.set(rule.id, rule);
    const unsubscribe = this.eventBus.on(rule.triggerType, async (event) => {
      await this.evaluate(rule, event);
    });
    this.unsubscribes.push(unsubscribe);
  }

  unregisterRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  listRules(): readonly AutomationRule[] {
    return [...this.rules.values()];
  }

  private async evaluate(rule: AutomationRule, event: RyperEvent): Promise<void> {
    if (rule.condition && !rule.condition(event)) {
      return;
    }
    for (const action of rule.actions) {
      if (action.requiredCapability) {
        try {
          this.broker.assertGranted(this.actorId, action.requiredCapability);
        } catch (err) {
          log.warn("skipping action: capability not granted", {
            rule: rule.id,
            action: action.name,
            error: String(err),
          });
          continue;
        }
      }
      await action.run(event);
    }
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
  }
}

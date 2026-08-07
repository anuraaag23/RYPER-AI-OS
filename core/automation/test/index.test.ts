import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { CapabilityBroker } from "@ryper/security";
import { AutomationEngine, type AutomationAction } from "../src/index.js";

describe("AutomationEngine", () => {
  it("runs an action with no capability requirement on trigger", async () => {
    const bus = new EventBus();
    const broker = new CapabilityBroker(() => true);
    const engine = new AutomationEngine(bus, broker);

    let ran = false;
    const action: AutomationAction = {
      name: "notify",
      run: () => {
        ran = true;
      },
    };
    engine.registerRule({ id: "r1", triggerType: "file.created", actions: [action] });

    await bus.emit("file.created", { path: "/tmp/x.pdf" });
    expect(ran).toBe(true);
  });

  it("skips an action requiring an ungranted capability", async () => {
    const bus = new EventBus();
    const broker = new CapabilityBroker(() => true); // no requests made, so nothing is granted
    const engine = new AutomationEngine(bus, broker);

    let ran = false;
    const action: AutomationAction = {
      name: "write-file",
      requiredCapability: "filesystem.write",
      run: () => {
        ran = true;
      },
    };
    engine.registerRule({ id: "r1", triggerType: "file.created", actions: [action] });

    await bus.emit("file.created", {});
    expect(ran).toBe(false);
  });

  it("honors a condition function before running actions", async () => {
    const bus = new EventBus();
    const broker = new CapabilityBroker(() => true);
    const engine = new AutomationEngine(bus, broker);

    let ran = false;
    engine.registerRule({
      id: "r1",
      triggerType: "file.created",
      condition: (event) => (event.payload as { ext?: string }).ext === "pdf",
      actions: [
        {
          name: "a",
          run: () => {
            ran = true;
          },
        },
      ],
    });

    await bus.emit("file.created", { ext: "txt" });
    expect(ran).toBe(false);
    await bus.emit("file.created", { ext: "pdf" });
    expect(ran).toBe(true);
  });

  it("dispose() stops the rule from reacting further", async () => {
    const bus = new EventBus();
    const broker = new CapabilityBroker(() => true);
    const engine = new AutomationEngine(bus, broker);
    let count = 0;
    engine.registerRule({
      id: "r1",
      triggerType: "ping",
      actions: [
        {
          name: "a",
          run: () => {
            count += 1;
          },
        },
      ],
    });

    await bus.emit("ping", {});
    engine.dispose();
    await bus.emit("ping", {});
    expect(count).toBe(1);
  });
});

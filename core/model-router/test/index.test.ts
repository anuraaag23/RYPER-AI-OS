import { describe, expect, it } from "vitest";
import { ModelRouter, type ModelProvider } from "../src/index.js";

const localProvider: ModelProvider = {
  id: "local-gguf",
  target: "local",
  generate: async (prompt) => `local:${prompt}`,
};

const cloudProvider: ModelProvider = {
  id: "cloud-api",
  target: "cloud",
  generate: async (prompt) => `cloud:${prompt}`,
};

describe("ModelRouter", () => {
  it("forces local when hint is local_only even if online", () => {
    const router = new ModelRouter();
    const decision = router.decide({
      hint: "local_only",
      device: { online: true },
    });
    expect(decision.target).toBe("local");
  });

  it("always routes privacy-sensitive requests locally", () => {
    const router = new ModelRouter();
    const decision = router.decide({
      hint: "auto",
      privacySensitive: true,
      requiresAdvancedReasoning: true,
      device: { online: true },
    });
    expect(decision.target).toBe("local");
    expect(decision.reason).toMatch(/privacy/);
  });

  it("routes to local when offline regardless of task needs", () => {
    const router = new ModelRouter();
    const decision = router.decide({
      hint: "auto",
      requiresWebSearch: true,
      device: { online: false },
    });
    expect(decision.target).toBe("local");
  });

  it("routes to cloud for web search when online", () => {
    const router = new ModelRouter();
    const decision = router.decide({
      hint: "auto",
      requiresWebSearch: true,
      device: { online: true },
    });
    expect(decision.target).toBe("cloud");
  });

  it("routes end-to-end through the registered provider", async () => {
    const router = new ModelRouter();
    router.registerProvider(localProvider);
    router.registerProvider(cloudProvider);

    const { decision, output } = await router.route(
      { hint: "auto", device: { online: false } },
      "hello",
    );

    expect(decision.target).toBe("local");
    expect(output).toBe("local:hello");
  });

  it("throws a clear error when no provider is registered for the decided target", async () => {
    const router = new ModelRouter();
    await expect(router.route({ hint: "auto", device: { online: true } }, "hi")).rejects.toThrow(
      /no model provider registered/,
    );
  });
});

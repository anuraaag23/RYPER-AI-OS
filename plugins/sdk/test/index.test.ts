import { describe, expect, it } from "vitest";
import { definePlugin } from "../src/index.js";

describe("definePlugin", () => {
  it("builds a manifest with sensible defaults", () => {
    const plugin = definePlugin({
      id: "hello-world",
      name: "Hello World",
      version: "0.1.0",
      actions: [{ name: "run", handler: () => "ok" }],
    });

    expect(plugin.manifest).toEqual({
      id: "hello-world",
      name: "Hello World",
      version: "0.1.0",
      requestedCapabilities: [],
      signed: false,
    });
  });

  it("rejects a non-kebab-case id", () => {
    expect(() =>
      definePlugin({
        id: "Hello World",
        name: "x",
        version: "0.1.0",
        actions: [{ name: "run", handler: () => "ok" }],
      }),
    ).toThrow(/kebab-case/);
  });

  it("rejects a plugin with zero actions", () => {
    expect(() => definePlugin({ id: "empty", name: "x", version: "0.1.0", actions: [] })).toThrow(
      /at least one action/,
    );
  });
});

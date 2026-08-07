import { describe, expect, it } from "vitest";
import { PluginLoggerFactory } from "../src/plugin-logger.js";

describe("PluginLoggerFactory", () => {
  it("returns the same logger instance for the same plugin id", () => {
    const factory = new PluginLoggerFactory();
    const a = factory.forPlugin("plugin-a");
    const b = factory.forPlugin("plugin-a");
    expect(a).toBe(b);
  });

  it("returns distinct loggers for distinct plugin ids", () => {
    const factory = new PluginLoggerFactory();
    const a = factory.forPlugin("plugin-a");
    const b = factory.forPlugin("plugin-b");
    expect(a).not.toBe(b);
  });
});

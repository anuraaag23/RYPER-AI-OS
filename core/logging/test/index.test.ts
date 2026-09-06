import { describe, expect, it } from "vitest";
import { Logger, type LogRecord } from "../src/index.js";

describe("Logger", () => {
  it("emits records at or above the configured minimum level", () => {
    const records: LogRecord[] = [];
    const logger = new Logger("test-scope", {
      minLevel: "warn",
      sink: (record) => records.push(record),
    });

    logger.debug("ignored");
    logger.info("also ignored");
    logger.warn("kept", { code: 1 });
    logger.error("also kept");

    expect(records).toHaveLength(2);
    expect(records[0]?.level).toBe("warn");
    expect(records[0]?.fields).toEqual({ code: 1 });
    expect(records[1]?.level).toBe("error");
  });

  it("child() namespaces the scope without mutating the parent", () => {
    const records: LogRecord[] = [];
    const parent = new Logger("core", { sink: (r) => records.push(r) });
    const child = parent.child("memory");

    parent.info("from parent");
    child.info("from child");

    expect(records[0]?.scope).toBe("core");
    expect(records[1]?.scope).toBe("core:memory");
  });

  it("includes an ISO timestamp on every record", () => {
    const records: LogRecord[] = [];
    const logger = new Logger("t", { sink: (r) => records.push(r) });
    logger.info("hello");
    expect(() => new Date(records[0]!.timestamp).toISOString()).not.toThrow();
  });
});

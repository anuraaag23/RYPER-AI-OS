import { describe, expect, it } from "vitest";
import { compareVersions, isNewerVersion, VersionManager } from "../src/model-versioning.js";

describe("compareVersions / isNewerVersion", () => {
  it("compares major, minor, and patch numerically", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.3.0", "1.2.9")).toBe(1);
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
  });

  it("isNewerVersion is a simple boolean wrapper", () => {
    expect(isNewerVersion("2.0.0", "1.9.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
  });
});

describe("VersionManager", () => {
  it("tracks the active version across installs", () => {
    const vm = new VersionManager();
    vm.recordInstall("model-a", { version: "1.0.0", localPath: "/v1", installedAt: "t1" });
    vm.recordInstall("model-a", { version: "1.1.0", localPath: "/v1.1", installedAt: "t2" });
    expect(vm.getActiveVersion("model-a")).toBe("1.1.0");
    expect(vm.getHistory("model-a")).toHaveLength(2);
  });

  it("rollback() repoints active to the immediately previous version", () => {
    const vm = new VersionManager();
    vm.recordInstall("model-a", { version: "1.0.0", localPath: "/v1", installedAt: "t1" });
    vm.recordInstall("model-a", { version: "1.1.0", localPath: "/v1.1", installedAt: "t2" });

    const previous = vm.rollback("model-a");
    expect(previous?.version).toBe("1.0.0");
    expect(vm.getActiveVersion("model-a")).toBe("1.0.0");
  });

  it("rollback() returns undefined when there is no earlier version", () => {
    const vm = new VersionManager();
    vm.recordInstall("model-a", { version: "1.0.0", localPath: "/v1", installedAt: "t1" });
    expect(vm.rollback("model-a")).toBeUndefined();
  });

  it("forget() clears all history for a model", () => {
    const vm = new VersionManager();
    vm.recordInstall("model-a", { version: "1.0.0", localPath: "/v1", installedAt: "t1" });
    vm.forget("model-a");
    expect(vm.getActiveVersion("model-a")).toBeUndefined();
    expect(vm.getHistory("model-a")).toHaveLength(0);
  });
});

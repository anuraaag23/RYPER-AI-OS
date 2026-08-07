import { describe, expect, it } from "vitest";
import { MemoryPermissions } from "../src/permissions.js";

describe("MemoryPermissions", () => {
  it("starts enabled with the default operations granted", () => {
    const permissions = new MemoryPermissions();
    expect(permissions.isEnabled()).toBe(true);
    expect(permissions.isGranted("view")).toBe(true);
    expect(permissions.isGranted("edit")).toBe(true);
  });

  it("disable()/enable() toggle the global switch", async () => {
    const permissions = new MemoryPermissions();
    await permissions.disable();
    expect(permissions.isEnabled()).toBe(false);
    await permissions.enable();
    expect(permissions.isEnabled()).toBe(true);
  });

  it("assertGranted throws for a revoked operation", () => {
    const permissions = new MemoryPermissions();
    permissions.revoke("export");
    expect(() => permissions.assertGranted("export")).toThrow(/not permitted/);
  });

  it("requestGrant() consults the injected consent prompt", async () => {
    const permissions = new MemoryPermissions(() => false);
    permissions.revoke("import");
    const approved = await permissions.requestGrant("import");
    expect(approved).toBe(false);
    expect(permissions.isGranted("import")).toBe(false);
  });

  it("requestGrant() grants when the consent prompt approves", async () => {
    const permissions = new MemoryPermissions(() => true);
    permissions.revoke("import");
    const approved = await permissions.requestGrant("import");
    expect(approved).toBe(true);
    expect(permissions.isGranted("import")).toBe(true);
  });
});

import { createLogger } from "@ryper/logging";
import type { DestructiveActionGate } from "./confirmation.js";
import type { WindowsSystemApi } from "./windows-system-api.js";
import type { RegistryHive, RegistryKeyInfo, RegistryValue } from "./types.js";

const log = createLogger("windows-agent:registry-interface");

export class RegistryWriteNotAuthorizedError extends Error {}

/**
 * The brief's "Registry Interface (read-only unless explicitly
 * authorized)" — reads are always allowed (subject to whatever the
 * injected `WindowsSystemApi`/OS itself enforces); writes require both
 * (a) this interface having been constructed with `allowWrites: true`
 * — an explicit, code-level opt-in a platform shell must make on
 * purpose — and (b) the `DestructiveActionGate` confirming the specific
 * write, since an unreviewed registry write can change "sensitive
 * system settings," one of the brief's named confirmation triggers.
 */
export class RegistryInterface {
  private readonly allowWrites: boolean;

  constructor(
    private readonly systemApi: WindowsSystemApi,
    private readonly destructiveGate: DestructiveActionGate,
    options: { readonly allowWrites?: boolean } = {},
  ) {
    this.allowWrites = options.allowWrites ?? false;
  }

  readValue(hive: RegistryHive, path: string, name: string): Promise<RegistryValue | undefined> {
    return this.systemApi.readRegistryValue(hive, path, name);
  }

  listValues(hive: RegistryHive, path: string): Promise<readonly RegistryValue[]> {
    return this.systemApi.listRegistryValues(hive, path);
  }

  inspectKey(hive: RegistryHive, path: string): Promise<RegistryKeyInfo> {
    return this.systemApi.inspectRegistryKey(hive, path);
  }

  async writeValue(value: RegistryValue): Promise<void> {
    if (!this.allowWrites) {
      throw new RegistryWriteNotAuthorizedError(
        `registry writes are disabled — construct RegistryInterface with { allowWrites: true } to enable "${value.hive}\\${value.path}\\${value.name}"`,
      );
    }
    await this.destructiveGate.require({
      action: "write_registry_value",
      target: `${value.hive}\\${value.path}\\${value.name}`,
      reason: "registry writes can change sensitive system settings",
    });
    await this.systemApi.writeRegistryValue(value);
    log.info("registry value written", { hive: value.hive, path: value.path, name: value.name });
  }

  async deleteValue(hive: RegistryHive, path: string, name: string): Promise<void> {
    if (!this.allowWrites) {
      throw new RegistryWriteNotAuthorizedError(
        `registry writes are disabled — construct RegistryInterface with { allowWrites: true } to enable "${hive}\\${path}\\${name}"`,
      );
    }
    await this.destructiveGate.require({
      action: "delete_registry_value",
      target: `${hive}\\${path}\\${name}`,
      reason: "deleting a registry value can impact applications or system settings",
    });
    await this.systemApi.deleteRegistryValue(hive, path, name);
    log.info("registry value deleted", { hive, path, name });
  }

  async deleteKey(hive: RegistryHive, path: string): Promise<void> {
    if (!this.allowWrites) {
      throw new RegistryWriteNotAuthorizedError(
        `registry writes are disabled — construct RegistryInterface with { allowWrites: true } to enable "${hive}\\${path}"`,
      );
    }
    await this.destructiveGate.require({
      action: "delete_registry_key",
      target: `${hive}\\${path}`,
      reason: "deleting a registry key can permanently remove system or application settings",
    });
    await this.systemApi.deleteRegistryKey(hive, path);
    log.info("registry key deleted", { hive, path });
  }
}

export function createRegistryInterface(
  systemApi: WindowsSystemApi,
  destructiveGate: DestructiveActionGate,
  options?: { readonly allowWrites?: boolean },
): RegistryInterface {
  return new RegistryInterface(systemApi, destructiveGate, options);
}

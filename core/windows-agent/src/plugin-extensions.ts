import { createLogger } from "@ryper/logging";
import type { AdapterInvocationContext } from "@ryper/platform-capability";

const log = createLogger("windows-agent:plugin-extensions");

export type WindowsCapabilityHandler = (
  parameters: Readonly<Record<string, unknown>>,
  context: AdapterInvocationContext,
) => Promise<unknown>;

export interface WindowsCapabilityExtension {
  readonly pluginId: string;
  readonly domain: string;
  readonly operation: string;
  readonly handler: WindowsCapabilityHandler;
}

/**
 * Lets a plugin contribute a Windows-specific capability implementation
 * — a new `(domain, operation)` pair `WindowsAdapter` doesn't natively
 * implement — without editing `windows-adapter.ts` at all, mirroring the
 * Phase 9 plugin pattern (`PluginRuntime`/`ToolPluginBridge`: the core
 * never special-cases a specific plugin, it just calls whatever was
 * registered). `WindowsAdapter.invoke()` checks this registry as its
 * fallback for any `(domain, operation)` it doesn't handle itself, so
 * adding a new capability is purely additive from a plugin's side.
 *
 * A plugin registers here in addition to, not instead of, declaring the
 * domain through `@ryper/platform-capability`'s
 * `PluginCapabilityAccess.registerCapability()` (see
 * `createPluginCapabilityContext` in `@ryper/platform-capability`) —
 * that call makes the domain visible to `CapabilityManager.discover()`
 * and permission-gates it; this registry is what actually runs it on
 * Windows.
 */
export class WindowsPluginCapabilityRegistry {
  private readonly extensions = new Map<string, WindowsCapabilityExtension>();

  private key(domain: string, operation: string): string {
    return `${domain}.${operation}`;
  }

  register(extension: WindowsCapabilityExtension): void {
    const key = this.key(extension.domain, extension.operation);
    if (this.extensions.has(key)) {
      throw new Error(
        `a handler for "${key}" is already registered (by plugin "${this.extensions.get(key)?.pluginId}")`,
      );
    }
    this.extensions.set(key, extension);
    log.info("plugin capability handler registered", {
      pluginId: extension.pluginId,
      domain: extension.domain,
      operation: extension.operation,
    });
  }

  unregister(pluginId: string, domain: string, operation: string): boolean {
    const key = this.key(domain, operation);
    const existing = this.extensions.get(key);
    if (!existing || existing.pluginId !== pluginId) return false;
    return this.extensions.delete(key);
  }

  /** Removes every handler a given plugin registered — called on plugin uninstall/disable. */
  unregisterAllForPlugin(pluginId: string): number {
    let removed = 0;
    for (const [key, extension] of this.extensions) {
      if (extension.pluginId === pluginId) {
        this.extensions.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get(domain: string, operation: string): WindowsCapabilityExtension | undefined {
    return this.extensions.get(this.key(domain, operation));
  }

  has(domain: string, operation: string): boolean {
    return this.extensions.has(this.key(domain, operation));
  }

  list(): readonly WindowsCapabilityExtension[] {
    return [...this.extensions.values()];
  }
}

export function createWindowsPluginCapabilityRegistry(): WindowsPluginCapabilityRegistry {
  return new WindowsPluginCapabilityRegistry();
}

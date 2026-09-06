import type { PluginRuntime } from "@ryper/plugin-runtime";
import type { PluginContext, PluginLifecycleHooks } from "@ryper/plugin-sdk";
import type { PluginEventBridge } from "./event-bridge.js";
import { createDependencyResolver, type PluginDependencyResolver } from "./dependency-resolver.js";
import { createManifestValidator, type PluginManifestValidator } from "./manifest-validator.js";
import { isValidUpdate } from "./store-format.js";
import type { PluginLifecycleManager } from "./lifecycle.js";
import type { PluginLoader } from "./plugin-loader.js";
import type { PluginPermissionManager } from "./permission-manager.js";
import type { PluginPlatformRegistry } from "./plugin-registry.js";
import type { PluginPackage } from "./types.js";

export class PluginInstallError extends Error {}

export interface PluginInstallerDeps {
  readonly runtime: PluginRuntime;
  readonly registry: PluginPlatformRegistry;
  readonly loader: PluginLoader;
  readonly lifecycle: PluginLifecycleManager;
  readonly permissions: PluginPermissionManager;
  readonly events: PluginEventBridge;
  readonly manifestValidator?: PluginManifestValidator;
  readonly dependencyResolver?: PluginDependencyResolver;
}

/**
 * Runs the brief's install/update/uninstall flows end to end: validate →
 * resolve dependencies → load (register with `PluginRuntime`/
 * `ToolPluginBridge`/`PlannerPluginRegistry`) → request permissions →
 * initialize → enable. Every step delegates to a module that already
 * owns that concern — this class only sequences them.
 */
export class PluginInstaller {
  private readonly manifestValidator: PluginManifestValidator;
  private readonly dependencyResolver: PluginDependencyResolver;

  constructor(private readonly deps: PluginInstallerDeps) {
    this.manifestValidator = deps.manifestValidator ?? createManifestValidator();
    this.dependencyResolver = deps.dependencyResolver ?? createDependencyResolver();
  }

  async install(pkg: PluginPackage): Promise<PluginContext> {
    const { extensionManifest, defined } = pkg;
    const validation = this.manifestValidator.validate(extensionManifest);
    if (!validation.valid) {
      throw new PluginInstallError(
        `manifest invalid for "${extensionManifest.id}": ${validation.errors.join("; ")}`,
      );
    }

    const existingManifests = this.deps.registry.list().map((record) => record.manifest);
    this.dependencyResolver.resolve([...existingManifests, extensionManifest]);

    const context = this.deps.loader.load(pkg);
    const pluginId = extensionManifest.id;

    await this.deps.lifecycle.install(pluginId);
    await this.deps.lifecycle.load(pluginId);
    await this.deps.permissions.requestForPlugin(
      pluginId,
      extensionManifest.permissions,
      `install "${extensionManifest.name}"`,
    );
    await this.deps.lifecycle.initialize(pluginId, defined.lifecycle, context);
    await this.deps.lifecycle.enable(pluginId, defined.lifecycle, context);
    return context;
  }

  async update(newPkg: PluginPackage): Promise<PluginContext> {
    const pluginId = newPkg.extensionManifest.id;
    const existing = this.deps.registry.get(pluginId);
    if (!existing) {
      throw new PluginInstallError(`cannot update "${pluginId}": it isn't installed`);
    }
    const compatibility = isValidUpdate(existing.manifest, newPkg.extensionManifest);
    if (!compatibility.compatible) {
      throw new PluginInstallError(`update rejected for "${pluginId}": ${compatibility.reason}`);
    }

    if (existing.state !== "enabled" && existing.state !== "disabled") {
      throw new PluginInstallError(
        `cannot update "${pluginId}": it must be enabled or disabled first (currently "${existing.state}")`,
      );
    }

    const currentContext = this.deps.loader.buildContext(pluginId, existing.manifest);
    if (existing.state === "enabled") {
      await this.deps.lifecycle.suspend(pluginId, newPkg.defined.lifecycle, currentContext);
    }
    this.deps.runtime.unregister(pluginId);

    const context = this.deps.loader.load(newPkg);
    await this.deps.lifecycle.enable(pluginId, newPkg.defined.lifecycle, context);
    return context;
  }

  async uninstall(pluginId: string, hooks: PluginLifecycleHooks): Promise<void> {
    const record = this.deps.registry.get(pluginId);
    if (!record) throw new PluginInstallError(`cannot uninstall "${pluginId}": it isn't installed`);

    const context = this.deps.loader.buildContext(pluginId, record.manifest);
    if (record.state === "enabled") {
      await this.deps.lifecycle.disable(pluginId, hooks, context);
    }
    await this.deps.lifecycle.uninstall(pluginId, hooks, context);
    this.deps.permissions.revokeForPlugin(pluginId, record.manifest.permissions);
    this.deps.events.unsubscribeAll(pluginId);
    this.deps.runtime.unregister(pluginId);
  }
}

export function createPluginInstaller(deps: PluginInstallerDeps): PluginInstaller {
  return new PluginInstaller(deps);
}

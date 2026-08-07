import type { ExtensionManifest } from "./types.js";
import { compareVersions } from "./semver.js";

export class DependencyResolutionError extends Error {}

export interface DependencyResolution {
  readonly installOrder: readonly string[];
}

/**
 * Given every manifest the platform knows about (already installed plus
 * whatever is about to be installed), computes a valid install order —
 * every dependency before its dependent — or throws with a precise
 * reason (missing dependency, version mismatch, or a cycle) rather than
 * silently guessing an order.
 */
export class PluginDependencyResolver {
  resolve(manifests: readonly ExtensionManifest[]): DependencyResolution {
    const byId = new Map(manifests.map((manifest) => [manifest.id, manifest]));

    for (const manifest of manifests) {
      for (const dependency of manifest.dependencies) {
        const found = byId.get(dependency.id);
        if (!found) {
          throw new DependencyResolutionError(
            `plugin "${manifest.id}" depends on "${dependency.id}", which isn't installed`,
          );
        }
        if (compareVersions(found.version, dependency.version) !== 0) {
          throw new DependencyResolutionError(
            `plugin "${manifest.id}" requires "${dependency.id}"@${dependency.version}, but ${found.version} is installed`,
          );
        }
      }
    }

    const state = new Map<string, "visiting" | "done">();
    const order: string[] = [];

    const visit = (id: string, chain: readonly string[]): void => {
      const status = state.get(id);
      if (status === "done") return;
      if (status === "visiting") {
        throw new DependencyResolutionError(
          `circular dependency detected: ${[...chain, id].join(" -> ")}`,
        );
      }
      state.set(id, "visiting");
      const manifest = byId.get(id);
      for (const dependency of manifest?.dependencies ?? []) {
        visit(dependency.id, [...chain, id]);
      }
      state.set(id, "done");
      order.push(id);
    };

    for (const manifest of manifests) {
      visit(manifest.id, []);
    }

    return { installOrder: order };
  }
}

export function createDependencyResolver(): PluginDependencyResolver {
  return new PluginDependencyResolver();
}

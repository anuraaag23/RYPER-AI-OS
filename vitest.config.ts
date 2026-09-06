import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Every `@ryper/*` package's `package.json` points `main`/`types` at
 * `./dist/...` — correct for a real consumer after `tsc --build` has
 * run, and what every package's own `main`/`types` fields should keep
 * doing (see `docs/adr/0012`). But Vite/Vitest's own module resolution
 * (`vite:import-analysis`) reads `main` directly off the filesystem at
 * test-collection time — it has no awareness of `tsc --build`'s
 * project-reference graph or build order. If a package hasn't been
 * built yet (a clean checkout, an isolated `npm test` run inside one
 * package directory, a CI job that runs build and test as separate
 * steps, ...), Vite fails with "Failed to resolve entry for package"
 * before a single test runs.
 *
 * `resolve.alias` below routes every `@ryper/<name>` import straight to
 * that package's TypeScript source (`<dir>/src/index.ts`) instead,
 * decoupling test execution from the build step entirely — Vitest
 * already transforms `.ts` test files on the fly via esbuild, so
 * transforming the workspace packages they import the same way costs
 * nothing extra and makes every package testable/importable
 * independently of build order, matching every prior phase's "every
 * workspace package must resolve ... during ... Testing" requirement.
 * Generated from each package's own `package.json` `name` field (the
 * same source of truth `npm`'s workspace resolution already uses)
 * rather than hand-maintained, so it cannot drift out of sync with the
 * actual package set.
 */
const WORKSPACE_GLOBS = ["core", "ui", "plugins", "plugins/examples", "platform", "infra"];

function discoverWorkspaceAliases(): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const group of WORKSPACE_GLOBS) {
    const groupDir = resolve(__dirname, group);
    let entries: string[];
    try {
      entries = readdirSync(groupDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const pkgDir = join(groupDir, entry);
      const pkgJsonPath = join(pkgDir, "package.json");
      const srcIndexPath = join(pkgDir, "src", "index.ts");
      try {
        if (!statSync(pkgJsonPath).isFile() || !statSync(srcIndexPath).isFile()) continue;
      } catch {
        continue;
      }
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as { name?: string };
      if (pkg.name) aliases[pkg.name] = srcIndexPath;
    }
  }
  return aliases;
}

export default defineConfig({
  resolve: {
    alias: discoverWorkspaceAliases(),
  },
  esbuild: {
    // Matches tsconfig.renderer.json's "jsx": "react-jsx" and vite.config.ts's
    // @vitejs/plugin-react: the automatic runtime injects its own jsx-runtime import,
    // so .tsx files never need `import React from "react"` just to use JSX.
    jsx: "automatic",
  },
  test: {
    environment: "node",
    include: [
      "core/*/test/**/*.test.ts",
      "ui/*/test/**/*.test.ts",
      "plugins/*/test/**/*.test.ts",
      "plugins/examples/*/test/**/*.test.ts",
      "platform/web/test/**/*.test.ts",
      "platform/desktop-app/test/**/*.test.ts",
      "platform/desktop-app/test/**/*.test.tsx",
      "infra/telemetry/test/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-electron/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: [
        "core/*/src/**/*.ts",
        "ui/*/src/**/*.ts",
        "plugins/*/src/**/*.ts",
        "plugins/examples/*/src/**/*.ts",
        "platform/web/src/**/*.ts",
        "platform/desktop-app/electron/**/*.ts",
        "platform/desktop-app/src/**/*.tsx",
        "infra/telemetry/src/**/*.ts",
      ],
    },
  },
});

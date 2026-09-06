// @ts-check
import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/dist-renderer/**",
      "**/dist-electron/**",
      "**/node_modules/**",
      "**/*.d.ts",
      "platform/desktop/**",
      "platform/mobile/**",
    ],
  },
  js.configs.recommended,
  {
    // Standalone Node.js verification/tooling scripts (Phase 13.8's
    // `scripts/verify-voice-runtime.mjs`) — real Node globals, no
    // TypeScript project (they're plain ESM `.mjs`, run directly with
    // `node`, not built).
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["warn", { allow: ["error"] }],
      // TypeScript already catches every real undefined-identifier error, with full type
      // information; the core (non-type-aware) `no-undef` rule can't see ambient global
      // namespaces used only in type position (`Electron.IpcMainInvokeEvent`, `NodeJS.
      // ErrnoException`, `JSX.Element`) and false-positives on them. Turning it off here is
      // typescript-eslint's own documented recommendation, not a suppressed real error.
      "no-undef": "off",
    },
  },
  {
    // The desktop app's renderer runs in Electron's Chromium renderer process (a browser
    // context, not Node) and uses JSX — a dedicated block so `window`/`document`/etc. resolve
    // and JSX parses, without giving browser globals to the rest of the (Node-only) repo.
    files: ["platform/desktop-app/src/**/*.ts", "platform/desktop-app/src/**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["warn", { allow: ["error"] }],
      // TypeScript already catches every real undefined-identifier error, with full type
      // information; the core (non-type-aware) `no-undef` rule can't see ambient global
      // namespaces used only in type position (`Electron.IpcMainInvokeEvent`, `NodeJS.
      // ErrnoException`, `JSX.Element`) and false-positives on them. Turning it off here is
      // typescript-eslint's own documented recommendation, not a suppressed real error.
      "no-undef": "off",
    },
  },
  eslintConfigPrettier,
];

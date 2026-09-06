import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Renderer-only build. The Electron main process and preload script are
// compiled separately via `tsc --build` (see tsconfig.json) — Vite never
// touches `electron/`. Base is relative so the built HTML/JS loads
// correctly from a `file://` URL, which is how Electron serves the
// renderer in production (no dev server).
export default defineConfig({
  root: resolve(__dirname),
  base: "./",
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "dist-renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        settings: resolve(__dirname, "settings.html"),
      },
    },
  },
  server: {
    port: 5273,
    strictPort: true,
  },
});

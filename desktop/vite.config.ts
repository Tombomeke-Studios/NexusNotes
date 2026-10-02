import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In the dev container the repo is a bind mount from the (Windows) host, where
// file-change events never arrive, so Vite would keep serving stale modules.
// Poll there instead, but skip build output: polling src-tauri/target or
// node_modules over the mount makes the dev server crawl (#367).
const inDevContainer = process.env.NEXUS_DEVCONTAINER === "1";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true,
    watch: inDevContainer
      ? {
          usePolling: true,
          interval: 500,
          ignored: ["**/node_modules/**", "**/src-tauri/**", "**/dist/**", "**/test-results/**", "**/playwright-report/**"],
        }
      : undefined,
  },
  build: {
    target: "esnext",
    minify: "esbuild",
  },
});

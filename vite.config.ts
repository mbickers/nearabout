import { execFileSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    "import.meta.env.VITE_GIT_BRANCH": JSON.stringify(
      execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(),
    ),
  },
  plugins: [react()],
  optimizeDeps: {
    // Pre-bundling maplibre-gl breaks its web worker entrypoint in dev, so tiles never parse.
    exclude: ["maplibre-gl"],
  },
});

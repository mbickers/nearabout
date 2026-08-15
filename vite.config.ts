import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Pre-bundling maplibre-gl breaks its web worker entrypoint in dev, so tiles never parse.
    exclude: ["maplibre-gl"],
  },
});

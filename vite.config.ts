import { execFileSync } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const reloadOnPublicChange = (): Plugin => {
  const publicDir = resolve("public");

  return {
    name: "reload-on-public-change",
    hotUpdate({ file }) {
      const publicPath = relative(publicDir, file);
      if (
        this.environment.name !== "client" ||
        publicPath.startsWith("..") ||
        isAbsolute(publicPath)
      )
        return;

      this.environment.hot.send({ type: "full-reload" });
      return [];
    },
  };
};

export default defineConfig({
  server: {
    host: "127.0.0.1",
  },
  define: {
    "import.meta.env.VITE_GIT_BRANCH": JSON.stringify(
      execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(),
    ),
  },
  plugins: [react(), reloadOnPublicChange()],
  optimizeDeps: {
    // Pre-bundling maplibre-gl breaks its web worker entrypoint in dev, so tiles never parse.
    exclude: ["maplibre-gl"],
  },
});

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";

function e2eOutDir(mode: string): string | undefined {
  if (mode === "mock") return "dist-mock";
  if (mode === "e2e-live") return "dist-e2e-live";
  return undefined;
}

export default defineConfig(({ mode }) => ({
  plugins: [vue()],
  resolve: {
    alias: {
      "@mplus/contracts": path.resolve(__dirname, "../../packages/contracts/src/index.ts"),
    },
  },
  build: {
    outDir: e2eOutDir(mode) ?? "dist",
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  envPrefix: "VITE_",
}));

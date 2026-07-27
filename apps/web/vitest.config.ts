import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [vue()],
  resolve: {
    alias: {
      "@mplus/contracts": path.resolve(root, "../../packages/contracts/src/index.ts"),
    },
  },
  test: {
    name: "web",
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.ts"],
    env: {
      VITE_API_MODE: "mock",
    },
  },
});

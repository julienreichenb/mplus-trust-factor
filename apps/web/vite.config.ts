import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@mplus/contracts": path.resolve(__dirname, "../../packages/contracts/src/index.ts"),
    },
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  envPrefix: "VITE_",
});

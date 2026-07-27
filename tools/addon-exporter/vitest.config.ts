import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@mplus/contracts": path.resolve(__dirname, "../../packages/contracts/src/index.ts"),
      "@mplus/domain": path.resolve(__dirname, "../../packages/domain/src/index.ts"),
    },
  },
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

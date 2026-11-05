import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __DEV__: "false" },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["tests/unit/setup.ts"],
  },
});

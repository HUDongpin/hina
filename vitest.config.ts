import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
      provider: "v8",
    },
    environment: "node",
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "main",
          include: ["src/main/**/*.test.ts"],
          environment: "node"
        }
      },
      {
        test: {
          name: "core",
          include: ["src/core/**/*.test.ts"],
          environment: "node"
        }
      },
      {
        test: {
          name: "renderer",
          include: ["src/renderer/**/*.test.ts", "src/renderer/**/*.test.tsx"],
          environment: "jsdom"
        }
      }
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"]
    }
  }
});

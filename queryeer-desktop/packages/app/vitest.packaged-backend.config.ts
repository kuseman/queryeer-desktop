import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/main/backend/packaged-backend.integration.test.ts"],
    environment: "node"
  }
});

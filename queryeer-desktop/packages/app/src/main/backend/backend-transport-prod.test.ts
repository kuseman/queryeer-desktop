import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveProdBackendLaunchPaths } from "./backend-transport-prod.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn()
}));

describe("resolveProdBackendLaunchPaths", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("uses packaged backend resources and bundled runtime", () => {
    process.env = { ...originalEnv };
    delete process.env.QUERYEER_APP_DIR;
    delete process.env.QUERYEER_RESOURCES_DIR;
    delete process.env.QUERYEER_BACKEND_DIR;
    delete process.env.QUERYEER_BACKEND_JAR;
    delete process.env.QUERYEER_JAVA_BIN;
    vi.mocked(existsSync).mockReturnValue(true);

    const paths = resolveProdBackendLaunchPaths(join("app", "resources"));

    expect(paths.appDir).toBeUndefined();
    expect(paths.resourcesDir).toBe(join("app", "resources"));
    expect(paths.javaBin).toContain(join("app", "resources", "backend", "runtime", "bin"));
    expect(paths.classpath).toContain(join("app", "resources", "backend", "backend-runner.jar"));
    expect(paths.classpath).toContain(join("app", "resources", "backend", "lib", "*"));
    expect(paths.workingDir).toBe(join("app", "resources", "backend"));
  });

  it("allows release smoke tests to override backend paths", () => {
    process.env = {
      ...originalEnv,
      QUERYEER_APP_DIR: "/tmp/queryeer-app",
      QUERYEER_RESOURCES_DIR: "/tmp/queryeer-resources",
      QUERYEER_BACKEND_DIR: "/tmp/queryeer-backend",
      QUERYEER_BACKEND_JAR: "/tmp/queryeer-backend/backend-runner.jar",
      QUERYEER_JAVA_BIN: "/tmp/java"
    };
    vi.mocked(existsSync).mockReturnValue(false);

    const paths = resolveProdBackendLaunchPaths(undefined);

    expect(paths.appDir).toBe("/tmp/queryeer-app");
    expect(paths.resourcesDir).toBe("/tmp/queryeer-resources");
    expect(paths.javaBin).toBe("/tmp/java");
    expect(paths.classpath).toContain("/tmp/queryeer-backend/backend-runner.jar");
    expect(paths.workingDir).toBe("/tmp/queryeer-backend");
  });
});

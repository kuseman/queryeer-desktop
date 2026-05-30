import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_BACKEND_JVM_ARGS, parseJvmArgs, resolveBackendJvmArgs } from "./backend-jvm-options.js";

describe("backend JVM options", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses safe defaults", async () => {
    delete process.env.QUERYEER_BACKEND_JVM_ARGS;

    await expect(resolveBackendJvmArgs(undefined)).resolves.toEqual([...DEFAULT_BACKEND_JVM_ARGS]);
  });

  it("uses environment override before settings", async () => {
    process.env = { ...originalEnv, QUERYEER_BACKEND_JVM_ARGS: "-Xms128m -Xmx1g" };

    await expect(resolveBackendJvmArgs(undefined)).resolves.toEqual(["-Xms128m", "-Xmx1g"]);
  });

  it("reads persisted backend settings", async ({ task }) => {
    delete process.env.QUERYEER_BACKEND_JVM_ARGS;
    const settingsDir = join("target", "test-work", task.id.replace(/\W/g, "-"));
    await mkdir(settingsDir, { recursive: true });
    await writeFile(join(settingsDir, "core.backend.json"), JSON.stringify({ values: { "core.backend.jvmArgs": "-Xms96m -Xmx768m" } }), "utf8");

    await expect(resolveBackendJvmArgs(settingsDir)).resolves.toEqual(["-Xms96m", "-Xmx768m"]);
  });

  it("parses quoted values", () => {
    expect(parseJvmArgs('-Xmx1g "-Dexample.path=C:\\Program Files\\Queryeer"')).toEqual(["-Xmx1g", "-Dexample.path=C:\\Program Files\\Queryeer"]);
  });
});

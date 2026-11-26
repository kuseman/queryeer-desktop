import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isReleaseBuild } from "./release-build";

describe("isReleaseBuild", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function appWith(metadata: Record<string, unknown> | null): string {
    const dir = mkdtempSync(join(tmpdir(), "queryeer-release-build-"));
    dirs.push(dir);
    if (metadata) {
      writeFileSync(join(dir, "package.json"), JSON.stringify(metadata));
    }
    return dir;
  }

  it("is a release only when packaged by the release workflow", () => {
    expect(isReleaseBuild(appWith({ version: "0.24.0", queryeerRelease: true }), true)).toBe(true);
    // A local package: package.json's version is the last release's
    expect(isReleaseBuild(appWith({ version: "0.23.0" }), true)).toBe(false);
    expect(isReleaseBuild(appWith({ version: "0.24.0", queryeerRelease: true }), false)).toBe(false);
    expect(isReleaseBuild(appWith(null), true)).toBe(false);
    expect(isReleaseBuild(appWith({ version: "0.24.0", queryeerRelease: "true" }), true)).toBe(true);
  });
});

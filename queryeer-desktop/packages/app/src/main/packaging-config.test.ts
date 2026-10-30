import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8")
);

describe("packaging configuration", () => {
  it("packages the audited Electron security baseline", () => {
    const dependencyVersion = packageJson.devDependencies.electron.replace(/^\^/, "");

    expect(dependencyVersion).toBe("45.0.0");
    expect(packageJson.build.electronVersion).toBe(dependencyVersion);
  });

  it("keeps platform application identities explicit", () => {
    expect(packageJson.desktopName).toBe("queryeer-desktop.desktop");
    expect(packageJson.build.linux).toMatchObject({
      category: "Development",
      executableName: "queryeer-desktop",
      syncDesktopName: true
    });
  });

  it("preserves Windows metadata and explicitly ad-hoc signs macOS builds", () => {
    expect(packageJson.build.win.signExecutable).toBe(false);
    expect(packageJson.build.win.signAndEditExecutable).toBeUndefined();
    expect(packageJson.build.mac.identity).toBe("-");
    expect(packageJson.build.mac.strictVerify).toBeUndefined();
  });
});

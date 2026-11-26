import { describe, expect, it } from "vitest";
import { compareVersions, isDevelopmentBuild, parseVersion, satisfies } from "./semver";

// The same cases as the backend's SemVerTest, so both halves of a plugin read a range the same way
describe("semver", () => {
  it.each([
    ["1.2.3", "1.2.3"],
    ["1.2.3", "=1.2.3"],
    ["1.2.3", "v1.2.3"],
    ["1.2.3", "^1.2.0"],
    ["1.9.9", "^1.2.0"],
    ["0.20.5", "^0.20.0"],
    ["0.0.3", "^0.0.3"],
    ["1.2.9", "~1.2.3"],
    ["1.5.0", "~1"],
    ["1.2.3", ">=1.2.3"],
    ["1.2.4", ">1.2.3"],
    ["1.2.2", "<1.2.3"],
    ["1.2.3", "<=1.2.3"],
    ["1.2.9", "<=1.2"],
    ["1.2.9", "1.2"],
    ["1.2.9", "1.2.x"],
    ["1.9.0", "1.x"],
    ["7.0.0", "*"],
    ["1.5.0", ">=1.2.3 <2.0.0"],
    ["1.5.0", ">= 1.2.3 < 2"],
    ["3.1.0", "^1.0.0 || ^3.0.0"],
    ["1.5.0", "1.2.3 - 2.0.0"],
    ["2.0.9", "1.2.3 - 2.0"],
    ["1.2.4-beta.2", "^1.2.4-beta.1"],
    ["1.2.4-beta.2", ">=1.2.4-alpha"],
    ["0.20.0-SNAPSHOT", "^0.20.0"],
    ["0.20.0-SNAPSHOT", ">=0.20.0"],
    ["1.2.3+build.5", "1.2.3"],
    ["0.20.0-SNAPSHOT", "0.20.0-SNAPSHOT"],
    ["0.20.0", "<=0.20.0-SNAPSHOT"],
    ["1.0.0", "~*"],
    ["9.9.9", "~x"],
    ["1.2.5", "~>1.2.3"],
    ["1.2.5", "~> 1.2.3"]
  ])("%s satisfies %s", (version, range) => {
    expect(satisfies(version, range)).toBe(true);
  });

  it.each([
    ["1.2.4", "1.2.3"],
    ["2.0.0", "^1.2.0"],
    ["1.1.9", "^1.2.0"],
    ["0.21.0", "^0.20.0"],
    ["0.19.9", "^0.20.0"],
    ["0.0.4", "^0.0.3"],
    ["1.3.0", "~1.2.3"],
    ["1.2.3", ">1.2.3"],
    ["1.2.3", "<1.2.3"],
    ["1.3.0", "<=1.2"],
    ["2.0.0", "1.x"],
    ["2.0.0", ">=1.2.3 <2.0.0"],
    ["2.5.0", "^1.0.0 || ^3.0.0"],
    ["2.0.1", "1.2.3 - 2.0.0"],
    ["2.1.0", "1.2.3 - 2.0"],
    ["1.2.0-beta.1", "^1.0.0"],
    ["1.2.4-beta.1", "^1.2.4-beta.2"],
    ["1.2.5-beta.1", "^1.2.4-beta.1"],
    ["1.2.0-beta.1", "*"],
    ["0.20.0-rc.1", "^0.20.0"],
    ["0.21.0-SNAPSHOT", "^0.20.0"],
    ["1.2.0-beta", ">=1.2.0-alpha <1.2"],
    ["1.2.0", "<1.2"],
    ["0.0.0", "<*"],
    ["1.3.0", "~>1.2.3"]
  ])("%s does not satisfy %s", (version, range) => {
    expect(satisfies(version, range)).toBe(false);
  });

  it.each(["", "abc", "^1.x.3", ">=1.2.3 ||", "1.2.3 - 2.0.0 - 3.0.0", "^1.2-beta", ">>1.2.3", ">2147483647", "^99999999999.0.0", "1.2.3-a..b"])(
    "refuses the range '%s'",
    (range) => {
      expect(() => satisfies("1.0.0", range)).toThrow();
    }
  );

  it("refuses invalid versions", () => {
    for (const version of ["1.2", "01.2.3", "latest", "1.2.3-a..b", "1.2.3-", "2147483647.0.0"]) {
      expect(() => parseVersion(version)).toThrow();
    }
  });

  it("knows development builds", () => {
    expect(isDevelopmentBuild("0.21.0-SNAPSHOT")).toBe(true);
    expect(isDevelopmentBuild("0.21.0-snapshot+build.5")).toBe(true);
    expect(isDevelopmentBuild("0.21.0")).toBe(false);
    expect(isDevelopmentBuild("0.21.0-beta.1")).toBe(false);
    expect(isDevelopmentBuild("SNAPSHOT")).toBe(false);
  });

  it("orders prereleases as SemVer does, also with long numeric identifiers", () => {
    const ordered = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0"];
    for (let i = 1; i < ordered.length; i++) {
      expect(compareVersions(parseVersion(ordered[i - 1]), parseVersion(ordered[i]))).toBeLessThan(0);
    }
    expect(satisfies("1.0.0-100000000000000000000", ">1.0.0-99999999999999999999")).toBe(true);
  });
});

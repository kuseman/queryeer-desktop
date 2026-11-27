import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleFromCatalog, copyBundle, javaFeatureVersion, selectBundledVersions, versionProblem, type CatalogVersion } from "../../scripts/bundle-plugins.mjs";
import { parseBundledPluginsLock } from "./plugins/bundled-plugins";

const target = { appVersion: "0.24.0", javaFeatureVersion: 25 };

function version(versionText: string, manifest: Record<string, unknown> = {}, prerelease = false): CatalogVersion {
  return {
    version: versionText,
    prerelease,
    url: `https://example.test/${versionText}.zip`,
    sha256: "0".repeat(64),
    manifest: { frontend: { apiVersion: ">=0.24.0 <1.0.0" }, backend: { minJavaVersion: "25" }, ...manifest }
  };
}

function catalog(plugins: Record<string, CatalogVersion[]>) {
  return { schemaVersion: 1, plugins: Object.entries(plugins).map(([id, versions]) => ({ id, versions })) };
}

describe("versionProblem", () => {
  it("checks the Queryeer range, the Java version and required dependency ranges", () => {
    expect(versionProblem(version("1.0.0"), target)).toBeUndefined();
    expect(versionProblem(version("1.0.0", {}, true), target)).toBe("a prerelease");
    expect(versionProblem(version("1.0.0", { frontend: { apiVersion: ">=0.25.0" } }), target)).toBe("needs Queryeer >=0.25.0, but this release is 0.24.0");
    expect(versionProblem(version("1.0.0", { backend: { minJavaVersion: "26" } }), target)).toBe("needs Java 26, but the release ships Java 25");
    expect(versionProblem(version("1.0.0", { backend: { minJavaVersion: "java25" } }), target)).toContain("must be a Java version");
    expect(versionProblem(version("1.0.0", { dependencies: [{ id: "queryengine.jdbc", version: ">=0.25.0" }] }), target)).toBe(
      "needs queryengine.jdbc >=0.25.0, but the release has 0.24.0"
    );
    expect(versionProblem(version("1.0.0", { frontend: { apiVersion: "not a range" } }), target)).toContain("can't check the range 'not a range'");
  });

  it("leaves optional dependencies and plain ids alone, and uses a bundled dependency's version", () => {
    const manifest = { dependencies: ["queryengine.sql.parser", { id: "queryengine.payloadbuilder", version: ">=0.30.0", optional: true }, { id: "com.example.base", version: "^2.0.0" }] };
    expect(versionProblem(version("1.0.0", manifest), target, (id) => (id === "com.example.base" ? "2.1.0" : undefined))).toBeUndefined();
    expect(versionProblem(version("1.0.0", manifest), target, (id) => (id === "com.example.base" ? "1.0.0" : undefined))).toBe("needs com.example.base ^2.0.0, but the release has 1.0.0");
    expect(versionProblem(version("1.0.0", manifest), target, (id) => (id === "com.example.base" ? null : undefined))).toBe("needs com.example.base, which can't be bundled");
  });

  it("checks only the Java version when no release version is given", () => {
    const local = { javaFeatureVersion: 25 };
    expect(versionProblem(version("1.0.0", { frontend: { apiVersion: ">=9.0.0" }, dependencies: [{ id: "queryengine.jdbc", version: ">=9.0.0" }] }), local)).toBeUndefined();
    expect(versionProblem(version("1.0.0", { backend: { minJavaVersion: "26" } }), local)).toBe("needs Java 26, but the release ships Java 25");
  });
});

describe("selectBundledVersions", () => {
  it("takes each plugin's newest compatible stable version and says which newer ones it passed over", () => {
    const selected = selectBundledVersions(
      catalog({
        "com.example.a": [version("2.1.0-beta.1", {}, true), version("2.0.0", { frontend: { apiVersion: ">=0.25.0" } }), version("1.9.0"), version("1.0.0")],
        "com.example.b": [version("0.1.0")]
      }),
      ["com.example.a", "com.example.b"],
      target
    );

    expect(selected.map((choice) => `${choice.id}@${choice.version}`)).toEqual(["com.example.a@1.9.0", "com.example.b@0.1.0"]);
    expect(selected[0].passedOver).toEqual([{ version: "2.0.0", prerelease: false, reason: "needs Queryeer >=0.25.0, but this release is 0.24.0" }]);
  });

  it("sorts versions itself rather than trusting the catalog's order", () => {
    const selected = selectBundledVersions(catalog({ "com.example.a": [version("1.2.0"), version("1.10.0"), version("1.9.0")] }), ["com.example.a"], target);
    expect(selected[0].version).toBe("1.10.0");
  });

  it("resolves a bundled dependency first and checks against the version it picked", () => {
    const selected = selectBundledVersions(
      catalog({
        "com.example.app": [version("2.0.0", { dependencies: [{ id: "com.example.base", version: "^2.0.0" }] }), version("1.0.0", { dependencies: [{ id: "com.example.base", version: "^1.0.0" }] })],
        "com.example.base": [version("2.0.0", { backend: { minJavaVersion: "26" } }), version("1.5.0")]
      }),
      ["com.example.app", "com.example.base"],
      target
    );

    expect(selected.map((choice) => `${choice.id}@${choice.version}`)).toEqual(["com.example.app@1.0.0", "com.example.base@1.5.0"]);
  });

  it("fails with every plugin that has no compatible version, a missing plugin, and an unknown catalog format", () => {
    expect(() =>
      selectBundledVersions(
        catalog({ "com.example.a": [version("1.0.0", { backend: { minJavaVersion: "26" } }), version("0.9.0-rc.1", {}, true)] }),
        ["com.example.a", "com.example.missing"],
        target
      )
    ).toThrow(
      "Can't bundle the plugins:\n  com.example.a: no version can be bundled (1.0.0 is not compatible: needs Java 26, but the release ships Java 25; 0.9.0-rc.1 is a prerelease)\n  com.example.missing: not in the plugin catalog"
    );
    expect(() => selectBundledVersions({ schemaVersion: 2, plugins: [] }, [], target)).toThrow("The plugin catalog's schemaVersion is 2; this release reads 1");
  });

  it("leaves out what it can't bundle, with the reason, when asked to (a local package)", () => {
    const problems: string[] = [];
    const selected = selectBundledVersions(
      catalog({
        "com.example.a": [version("1.0.0")],
        "com.example.needs-missing": [version("1.0.0", { dependencies: [{ id: "com.example.missing", version: "*" }] })]
      }),
      ["com.example.a", "com.example.missing", "com.example.needs-missing"],
      target,
      (problem) => problems.push(problem)
    );

    expect(selected.map((choice) => choice.id)).toEqual(["com.example.a"]);
    expect(problems).toEqual([
      "com.example.missing: not in the plugin catalog",
      "com.example.needs-missing: no version can be bundled (1.0.0 is not compatible: needs com.example.missing, which can't be bundled)"
    ]);
  });

  it("fails on bundled plugins that require each other", () => {
    expect(() =>
      selectBundledVersions(
        catalog({
          "com.example.a": [version("1.0.0", { dependencies: [{ id: "com.example.b", version: "*" }] })],
          "com.example.b": [version("1.0.0", { dependencies: [{ id: "com.example.a", version: "*" }] })]
        }),
        ["com.example.a", "com.example.b"],
        target
      )
    ).toThrow(
      "Can't bundle the plugins:\n  com.example.a: no version can be bundled (1.0.0 is not compatible: needs com.example.b, which can't be bundled)\n  com.example.b: no version can be bundled (1.0.0 is not compatible: needs com.example.a, which can't be bundled)"
    );
  });

  it("takes an older version of a dependency that doesn't require the plugin back", () => {
    const selected = selectBundledVersions(
      catalog({
        "com.example.a": [version("2.0.0", { dependencies: [{ id: "com.example.b", version: "*" }] })],
        "com.example.b": [version("2.0.0", { dependencies: [{ id: "com.example.a", version: "*" }] }), version("1.0.0")]
      }),
      ["com.example.a", "com.example.b"],
      target
    );

    expect(selected.map((choice) => `${choice.id}@${choice.version}`)).toEqual(["com.example.a@2.0.0", "com.example.b@1.0.0"]);
    expect(selected[1].passedOver).toEqual([{ version: "2.0.0", prerelease: false, reason: "needs com.example.a, and com.example.a needs com.example.b" }]);
  });
});

describe("bundling", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "queryeer-bundle-plugins-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const zipBytes = Buffer.from("PK zip bytes");
  const zipSha = createHash("sha256").update(zipBytes).digest("hex");
  const quiet = () => undefined;

  function catalogWithZip(sha256 = zipSha, size = zipBytes.length) {
    return catalog({ "com.example.a": [{ ...version("1.0.0"), url: "https://example.test/a.zip", sha256, size }] });
  }

  it("downloads each chosen ZIP, checks it and writes a lock the app reads", async () => {
    const outDir = join(root, "bundled");
    mkdirSync(outDir);
    writeFileSync(join(outDir, "stale.zip"), "old");

    const plugins = await bundleFromCatalog({ catalog: catalogWithZip(), ids: ["com.example.a"], target, outDir, read: async () => zipBytes, log: quiet });

    expect(plugins).toEqual([{ id: "com.example.a", version: "1.0.0", file: "com.example.a-1.0.0.zip", sha256: zipSha, url: "https://example.test/a.zip" }]);
    expect(readdirSync(outDir).sort()).toEqual(["bundled-plugins.lock.json", "com.example.a-1.0.0.zip"]);
    expect(parseBundledPluginsLock(readFileSync(join(outDir, "bundled-plugins.lock.json"), "utf8")).plugins).toEqual(plugins);
  });

  it("fails on a ZIP that doesn't match the catalog", async () => {
    const outDir = join(root, "bundled");
    await expect(bundleFromCatalog({ catalog: catalogWithZip("f".repeat(64)), ids: ["com.example.a"], target, outDir, read: async () => zipBytes, log: quiet })).rejects.toThrow(
      "doesn't match the catalog's sha256"
    );
    await expect(bundleFromCatalog({ catalog: catalogWithZip(zipSha, 1), ids: ["com.example.a"], target, outDir, read: async () => zipBytes, log: quiet })).rejects.toThrow(
      "the catalog says 1"
    );
  });

  it("copies a bundle staged before after checking it again", async () => {
    const staged = join(root, "staged");
    await bundleFromCatalog({ catalog: catalogWithZip(), ids: ["com.example.a"], target, outDir: staged, read: async () => zipBytes, log: quiet });
    const outDir = join(root, "bundled");

    expect(copyBundle({ sourceDir: staged, ids: ["com.example.a"], outDir, log: quiet }).map((plugin) => plugin.version)).toEqual(["1.0.0"]);
    expect(readdirSync(outDir).sort()).toEqual(["bundled-plugins.lock.json", "com.example.a-1.0.0.zip"]);

    expect(() => copyBundle({ sourceDir: staged, ids: ["com.example.a", "com.example.b"], outDir, log: quiet })).toThrow(
      "bundles com.example.a, but bundled-plugins.json lists com.example.a, com.example.b"
    );
    writeFileSync(join(staged, "com.example.a-1.0.0.zip"), "tampered");
    expect(() => copyBundle({ sourceDir: staged, ids: ["com.example.a"], outDir, log: quiet })).toThrow("doesn't match its sha256");
  });
});

describe("javaFeatureVersion", () => {
  it("reads the feature version from the runtime's release file", () => {
    const javaHome = mkdtempSync(join(tmpdir(), "queryeer-java-"));
    try {
      writeFileSync(join(javaHome, "release"), 'IMPLEMENTOR="Azul Systems, Inc."\nJAVA_VERSION="25.0.5"\n');
      expect(javaFeatureVersion(javaHome)).toBe(25);
      expect(() => javaFeatureVersion(join(javaHome, "missing"))).toThrow("No Java runtime");
    } finally {
      rmSync(javaHome, { recursive: true, force: true });
    }
  });
});

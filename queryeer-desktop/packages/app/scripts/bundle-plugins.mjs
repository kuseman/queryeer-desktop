/**
 * Stages the plugins a release bundles (bundled-plugins.json) into dist/release-resources/plugins/bundled/: their ZIPs
 * and bundled-plugins.lock.json, which the app installs from on the first start of a new version.
 *
 *   node scripts/bundle-plugins.mjs [--out <dir>] [--java-home <dir>]   picks each plugin's newest compatible version in
 *                                                                         the plugin catalog and downloads it
 *   node scripts/bundle-plugins.mjs --from <dir> [--out <dir>]           copies a bundle staged before, checking it again
 *
 * The release picks the versions once and every platform build copies that bundle (QUERYEER_BUNDLED_PLUGINS_FROM), so
 * all platforms ship the same versions even when a plugin is released during the run.
 *
 * Compatibility is read from each version's manifest in the catalog, with the app's rules: frontend.apiVersion and the
 * version ranges of required dependencies (a bundled plugin's version, otherwise the release version, as core's plugins
 * carry it), checked only when QUERYEER_RELEASE_VERSION is set; backend.minJavaVersion against the Java the release
 * ships. requiredCapabilities are not checked.
 */
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions, parseVersion, satisfies } from "../src/main/plugins/semver.ts";

export const BUNDLED_PLUGINS_LOCK_FILE = "bundled-plugins.lock.json";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

/** The feature version (25) of the Java in `javaHome`, from its `release` file. */
export function javaFeatureVersion(javaHome) {
  const releaseFile = join(javaHome, "release");
  if (!existsSync(releaseFile)) {
    throw new Error(`No Java runtime in ${javaHome}: ${releaseFile} is missing`);
  }
  const match = /^JAVA_VERSION="(\d+)/m.exec(readFileSync(releaseFile, "utf8"));
  if (!match) {
    throw new Error(`${releaseFile} has no JAVA_VERSION`);
  }
  return Number(match[1]);
}

/**
 * Why a catalog version can't be bundled, or undefined when it can.
 *
 * @param target `{ appVersion?, javaFeatureVersion }`; without `appVersion` the ranges on Queryeer's version aren't checked
 * @param bundledVersionOf a dependency's version when it is a bundled plugin: its chosen version, or null when none can
 *   be chosen; undefined when it isn't bundled, so it is one of core's plugins, which carry the release version
 */
export function versionProblem(entry, target, bundledVersionOf = () => undefined) {
  if (entry.prerelease) {
    return "a prerelease";
  }
  const manifest = entry.manifest ?? {};
  const inRange = (version, range) => {
    try {
      return satisfies(version, range);
    } catch (error) {
      throw new Error(`can't check the range '${range}': ${message(error)}`);
    }
  };
  try {
    const apiVersion = manifest.frontend?.apiVersion;
    if (target.appVersion && typeof apiVersion === "string" && apiVersion.trim() !== "" && !inRange(target.appVersion, apiVersion)) {
      return `needs Queryeer ${apiVersion}, but this release is ${target.appVersion}`;
    }
    const minJavaVersion = manifest.backend?.minJavaVersion;
    if (typeof minJavaVersion === "string" && minJavaVersion.trim() !== "") {
      if (!/^\d+$/.test(minJavaVersion.trim())) {
        return `backend.minJavaVersion must be a Java version such as "25", not "${minJavaVersion}"`;
      }
      if (Number(minJavaVersion) > target.javaFeatureVersion) {
        return `needs Java ${minJavaVersion.trim()}, but the release ships Java ${target.javaFeatureVersion}`;
      }
    }
    for (const dependency of Array.isArray(manifest.dependencies) ? manifest.dependencies : []) {
      // An optional dependency out of range is left out at runtime; the plugin still loads
      if (typeof dependency !== "object" || dependency === null || dependency.optional === true || typeof dependency.version !== "string") {
        continue;
      }
      const bundledVersion = bundledVersionOf(dependency.id);
      if (bundledVersion === null) {
        return `needs ${dependency.id}, which can't be bundled`;
      }
      const version = bundledVersion ?? target.appVersion;
      if (version && !inRange(version, dependency.version)) {
        return `needs ${dependency.id} ${dependency.version}, but the release has ${version}`;
      }
    }
  } catch (error) {
    return message(error);
  }
  return undefined;
}

/**
 * Each bundled plugin's newest version that can be bundled, as `{ id, version, url, sha256, size?, passedOver }`
 * (`passedOver`: newer stable versions that can't, with the reason). Throws with every plugin that has none, unless
 * `leaveOut` is given: then those plugins are left out and `leaveOut` gets each reason (a local package).
 */
export function selectBundledVersions(catalog, ids, target, leaveOut) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.plugins)) {
    throw new Error(`The plugin catalog's schemaVersion is ${JSON.stringify(catalog?.schemaVersion)}; this release reads 1`);
  }
  const byId = new Map(catalog.plugins.map((plugin) => [plugin.id, plugin]));
  const bundled = new Set(ids);
  const chosen = new Map();
  const resolving = new Set();
  const problems = [];
  // Whether the plugin being chosen ran into a dependency still being chosen: when it then has no version, that is
  // provisional (an older version of the plugin below may not need it), so it is neither kept nor reported
  let cycleHit = false;

  const bundledVersionOf = (requiringId) => (dependencyId) => {
    if (!bundled.has(dependencyId)) {
      return undefined;
    }
    if (resolving.has(dependencyId)) {
      cycleHit = true;
      // versionProblem reports what this throws as the version's problem
      throw new Error(`needs ${dependencyId}, and ${dependencyId} needs ${requiringId}`);
    }
    return choose(dependencyId)?.version ?? null;
  };

  const choose = (id) => {
    if (chosen.has(id)) {
      return chosen.get(id);
    }
    resolving.add(id);
    const outerCycleHit = cycleHit;
    cycleHit = false;
    let choice = null;
    const plugin = byId.get(id);
    if (!plugin) {
      problems.push(`${id}: not in the plugin catalog`);
    } else {
      const rejected = [];
      const versions = [...(Array.isArray(plugin.versions) ? plugin.versions : [])].sort((left, right) => {
        try {
          return compareVersions(parseVersion(right.version), parseVersion(left.version));
        } catch {
          return 0;
        }
      });
      for (const entry of versions) {
        const problem = versionProblem(entry, target, bundledVersionOf(id));
        if (problem === undefined) {
          choice = { id, version: entry.version, url: entry.url, sha256: entry.sha256, size: entry.size, passedOver: rejected.filter((item) => !item.prerelease) };
          break;
        }
        rejected.push({ version: entry.version, prerelease: entry.prerelease === true, reason: problem });
      }
      if (!choice && !(cycleHit && resolving.size > 1)) {
        const tried = rejected.map((item) => `${item.version} is ${item.prerelease ? item.reason : `not compatible: ${item.reason}`}`);
        problems.push(`${id}: no version can be bundled${tried.length > 0 ? ` (${tried.join("; ")})` : ""}`);
      }
    }
    resolving.delete(id);
    // A plugin chosen from the top is always final; one that failed only on a dependency still being chosen is chosen
    // again from the top
    if (choice || !cycleHit || resolving.size === 0) {
      chosen.set(id, choice);
    }
    cycleHit = outerCycleHit || cycleHit;
    return choice;
  };

  const selected = ids.map(choose);
  if (problems.length > 0) {
    if (!leaveOut) {
      throw new Error(`Can't bundle the plugins:\n  ${[...new Set(problems)].join("\n  ")}`);
    }
    [...new Set(problems)].forEach((problem) => leaveOut(problem));
  }
  return selected.filter((choice) => choice !== null);
}

/** The bytes at an http(s) URL, a file: URL or a path; retries a failed download twice. */
export async function readSource(source) {
  if (!/^https?:\/\//i.test(source)) {
    return readFileSync(source.startsWith("file:") ? fileURLToPath(source) : source);
  }
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((done) => setTimeout(done, attempt * 2000));
      }
    }
  }
  throw new Error(`Can't download ${source}: ${message(lastError)}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function zipFileName(id, version) {
  return `${id}-${version}.zip`;
}

function writeLock(outDir, plugins) {
  writeFileSync(join(outDir, BUNDLED_PLUGINS_LOCK_FILE), `${JSON.stringify({ schemaVersion: 1, plugins }, null, 2)}\n`);
}

function emptyDirectory(directory) {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
}

/** Picks the versions, downloads and checks each ZIP, and writes them with the lock to `outDir`. Returns the lock's plugins. */
export async function bundleFromCatalog({ catalog, ids, target, outDir, leaveOut, read = readSource, log = console.log }) {
  const selected = selectBundledVersions(catalog, ids, target, leaveOut);
  emptyDirectory(outDir);
  const plugins = [];
  for (const choice of selected) {
    for (const skipped of choice.passedOver) {
      log(`  ${choice.id} ${skipped.version} is left out: ${skipped.reason}`);
    }
    const bytes = await read(choice.url);
    const actual = sha256(bytes);
    if (actual !== choice.sha256?.toLowerCase()) {
      throw new Error(`${choice.url} doesn't match the catalog's sha256 (${choice.sha256}, downloaded ${actual})`);
    }
    if (typeof choice.size === "number" && bytes.length !== choice.size) {
      throw new Error(`${choice.url} is ${bytes.length} bytes, the catalog says ${choice.size}`);
    }
    const file = zipFileName(choice.id, choice.version);
    writeFileSync(join(outDir, file), bytes);
    plugins.push({ id: choice.id, version: choice.version, file, sha256: actual, url: choice.url });
    log(`  ${choice.id} ${choice.version}`);
  }
  writeLock(outDir, plugins);
  return plugins;
}

/** Copies a bundle staged before to `outDir`, after checking that it holds exactly `ids` and each ZIP's sha256. */
export function copyBundle({ sourceDir, ids, outDir, log = console.log }) {
  const lockPath = join(sourceDir, BUNDLED_PLUGINS_LOCK_FILE);
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  if (lock?.schemaVersion !== 1 || !Array.isArray(lock.plugins)) {
    throw new Error(`${lockPath} must have schemaVersion 1 and a plugins array`);
  }
  const lockIds = lock.plugins.map((plugin) => plugin.id).sort();
  const expected = [...ids].sort();
  if (JSON.stringify(lockIds) !== JSON.stringify(expected)) {
    throw new Error(`${lockPath} bundles ${lockIds.join(", ")}, but bundled-plugins.json lists ${expected.join(", ")}`);
  }
  if (resolve(sourceDir) === resolve(outDir)) {
    throw new Error(`The bundle to copy is already in ${outDir}`);
  }
  emptyDirectory(outDir);
  for (const plugin of lock.plugins) {
    if (plugin.file !== zipFileName(plugin.id, plugin.version)) {
      throw new Error(`${lockPath}: ${plugin.id} names the file ${plugin.file}`);
    }
    const bytes = readFileSync(join(sourceDir, plugin.file));
    if (sha256(bytes) !== plugin.sha256) {
      throw new Error(`${plugin.file} doesn't match its sha256 in ${lockPath}`);
    }
    copyFileSync(join(sourceDir, plugin.file), join(outDir, plugin.file));
    log(`  ${plugin.id} ${plugin.version}`);
  }
  writeLock(outDir, lock.plugins);
  return lock.plugins;
}

function argument(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} needs a value`);
  }
  return value;
}

async function main(args, env) {
  const config = JSON.parse(readFileSync(join(projectRoot, "bundled-plugins.json"), "utf8"));
  const ids = config.plugins;
  const releaseVersion = env.QUERYEER_RELEASE_VERSION?.trim() || undefined;
  const outDir = resolve(argument(args, "--out") ?? join(env.QUERYEER_RELEASE_RESOURCES_DIR ?? join(projectRoot, "dist", "release-resources"), "plugins", "bundled"));

  if (env.QUERYEER_SKIP_BUNDLED_PLUGINS === "true") {
    if (releaseVersion) {
      throw new Error("QUERYEER_SKIP_BUNDLED_PLUGINS is for local packages; a release always bundles its plugins");
    }
    rmSync(outDir, { recursive: true, force: true });
    console.log("Skipped bundling plugins (QUERYEER_SKIP_BUNDLED_PLUGINS=true)");
    return;
  }

  const from = argument(args, "--from") ?? (env.QUERYEER_BUNDLED_PLUGINS_FROM?.trim() || undefined);
  let plugins;
  if (from) {
    console.log(`Copying the bundled plugins from ${from}:`);
    plugins = copyBundle({ sourceDir: resolve(from), ids, outDir });
  } else {
    const javaHome = argument(args, "--java-home") ?? env.QUERYEER_JLINK_OUTPUT ?? env.JAVA_HOME;
    if (!javaHome) {
      throw new Error("Pass --java-home, or set QUERYEER_JLINK_OUTPUT or JAVA_HOME, to the Java the release ships");
    }
    const target = { appVersion: releaseVersion, javaFeatureVersion: javaFeatureVersion(resolve(javaHome)) };
    const catalogSource = env.QUERYEER_PLUGIN_CATALOG_URL?.trim() || config.catalogUrl;
    if (!releaseVersion) {
      console.log("Not a release (QUERYEER_RELEASE_VERSION isn't set): frontend.apiVersion and dependency ranges aren't checked, and a plugin that can't be bundled is left out");
    }
    console.log(`Bundling plugins from ${catalogSource} for Java ${target.javaFeatureVersion}${releaseVersion ? ` and Queryeer ${releaseVersion}` : ""}:`);
    let catalog;
    try {
      catalog = JSON.parse((await readSource(catalogSource)).toString("utf8"));
    } catch (error) {
      throw new Error(`Can't read the plugin catalog ${catalogSource}: ${message(error)}`);
    }
    // A local package leaves out what it can't bundle, e.g. a plugin that isn't released yet; a release fails on it
    const leaveOut = releaseVersion ? undefined : (problem) => console.warn(`  Left out: ${problem}`);
    plugins = await bundleFromCatalog({ catalog, ids, target, outDir, leaveOut });
    if (env.GITHUB_STEP_SUMMARY) {
      const rows = plugins.map((plugin) => `| ${plugin.id} | ${plugin.version} |`).join("\n");
      appendFileSync(env.GITHUB_STEP_SUMMARY, `### Bundled plugins\n\n| Plugin | Version |\n| --- | --- |\n${rows}\n`);
    }
  }
  console.log(`Staged ${plugins.length} bundled plugins: ${outDir}`);
}

// Real paths on both sides: Node resolves links in the module's path but not in argv[1], so a checkout reached through
// a junction or symlink would otherwise skip main() and stage nothing
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  main(process.argv.slice(2), process.env).catch((error) => {
    console.error(message(error));
    // Not process.exit(): on Windows it aborts in libuv while fetch's sockets are closing
    process.exitCode = 1;
  });
}

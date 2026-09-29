import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getBackendRoot, getBackendVersion, getModulesByPluginId } from "./backend-catalog.mjs";
import { copyDereferenced } from "./copy-dereferenced.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const repoRoot = resolve(projectRoot, "..", "..", "..");
const backendRoot = getBackendRoot();
const backendVersion = getBackendVersion();
const stageRoot = resolve(process.env.QUERYEER_RELEASE_RESOURCES_DIR ?? join(projectRoot, "dist", "release-resources"));
const jlinkHome = resolve(process.env.QUERYEER_JLINK_OUTPUT ?? join(repoRoot, ".backend-jlink"));

const moduleByPluginId = getModulesByPluginId();

function fail(message) {
  console.error(message);
  process.exit(1);
}

function findJar(targetDir, artifactId) {
  if (!existsSync(targetDir)) {
    fail(`Maven target directory not found: ${targetDir}`);
  }
  const entries = readdirSync(targetDir);
  const jarName = `${artifactId}-${backendVersion}.jar`;
  if (!entries.includes(jarName)) {
    fail(`Expected ${jarName} in ${targetDir}`);
  }
  return join(targetDir, jarName);
}

function copyClasspathFileEntries(classpathFile, outputDir) {
  if (!existsSync(classpathFile)) {
    fail(`Classpath file not found: ${classpathFile}`);
  }
  const raw = readFileSync(classpathFile, "utf8").trim();
  if (!raw) {
    return;
  }
  for (const entry of raw.split(delimiter).map((value) => value.trim()).filter(Boolean)) {
    if (entry.endsWith(".jar") && existsSync(entry)) {
      copyFileSync(entry, join(outputDir, basename(entry)));
    }
  }
}

function assertNoSymbolicLinks(directory) {
  for (const entry of readdirSync(directory)) {
    const entryPath = join(directory, entry);
    const stats = lstatSync(entryPath);
    if (stats.isSymbolicLink()) {
      fail(`Release resources must not contain symbolic links: ${entryPath}`);
    }
    if (stats.isDirectory()) {
      assertNoSymbolicLinks(entryPath);
    }
  }
}

if (!existsSync(join(jlinkHome, "bin"))) {
  fail(`jlink runtime not found. Run npm run backend:jlink first or set QUERYEER_JLINK_OUTPUT: ${jlinkHome}`);
}

rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(stageRoot, { recursive: true });

const backendOut = join(stageRoot, "backend");
const backendLibOut = join(backendOut, "lib");
mkdirSync(backendLibOut, { recursive: true });

const runnerTarget = join(backendRoot, "backend-runner", "target");
copyFileSync(findJar(runnerTarget, "backend-runner"), join(backendOut, "backend-runner.jar"));
copyClasspathFileEntries(join(runnerTarget, "queryeer-runner-classpath.txt"), backendLibOut);
copyDereferenced(jlinkHome, join(backendOut, "runtime"));

const pluginsOut = join(stageRoot, "plugins", "builtin");
mkdirSync(pluginsOut, { recursive: true });

for (const [pluginId, moduleName] of moduleByPluginId) {
  const pluginDistribution = join(backendRoot, moduleName, "target", pluginId);
  if (!existsSync(pluginDistribution)) {
    fail(`Backend plugin distribution not found: ${pluginDistribution}`);
  }
  const pluginOut = join(pluginsOut, pluginId);
  const pluginLibOut = join(pluginOut, "lib");
  const pluginTarget = join(backendRoot, moduleName, "target");
  mkdirSync(pluginLibOut, { recursive: true });
  copyFileSync(join(pluginDistribution, "plugin.json"), join(pluginOut, "plugin.json"));
  copyFileSync(findJar(pluginTarget, moduleName), join(pluginLibOut, `${moduleName}-${backendVersion}.jar`));
  copyClasspathFileEntries(join(pluginTarget, "queryeer-plugin-deps.txt"), pluginLibOut);
}

assertNoSymbolicLinks(stageRoot);

console.log(`Staged release resources: ${stageRoot}`);

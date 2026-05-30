import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { basename, delimiter, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(projectRoot, "..", "..", "..");
const backendRoot = join(repoRoot, "queryeer-backend");
const stageRoot = resolve(process.env.QUERYEER_RELEASE_RESOURCES_DIR ?? join(projectRoot, "dist", "release-resources"));
const jlinkHome = resolve(process.env.QUERYEER_JLINK_OUTPUT ?? join(repoRoot, ".backend-jlink"));

const moduleByPluginId = new Map([
  ["queryengine.runtime.jdbc-foundation", "backend-lib-queryengine-jdbc-foundation"],
  ["queryengine.runtime.sql-parser", "backend-lib-queryengine-sql-parser"],
  ["queryengine.jdbc", "backend-plugin-jdbc"],
  ["queryengine.payloadbuilder", "backend-plugin-payloadbuilder"],
  ["queryengine.jdbc.dialect.sqlserver", "backend-plugin-dialect-sqlserver"],
  ["queryengine.jdbc.dialect.postgres", "backend-plugin-dialect-postgres"]
]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function findJar(targetDir, artifactId) {
  if (!existsSync(targetDir)) {
    fail(`Maven target directory not found: ${targetDir}`);
  }
  const entries = readdirSync(targetDir);
  const jars = entries
    .filter((name) => name.endsWith(".jar"))
    .filter((name) => name.startsWith(`${artifactId}-`))
    .filter((name) => !name.includes("-sources") && !name.includes("-javadoc") && !name.includes("-tests"));
  if (jars.length !== 1) {
    fail(`Expected one ${artifactId} jar in ${targetDir}, found ${jars.length}: ${jars.join(", ")}`);
  }
  return join(targetDir, jars[0]);
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
cpSync(jlinkHome, join(backendOut, "runtime"), { recursive: true });

const pluginsOut = join(stageRoot, "plugins", "builtin");
mkdirSync(pluginsOut, { recursive: true });

for (const [pluginId, moduleName] of moduleByPluginId) {
  const pluginDistribution = join(backendRoot, moduleName, "target", pluginId);
  if (!existsSync(pluginDistribution)) {
    fail(`Backend plugin distribution not found: ${pluginDistribution}`);
  }
  cpSync(pluginDistribution, join(pluginsOut, pluginId), { recursive: true });
}

console.log(`Staged release resources: ${stageRoot}`);

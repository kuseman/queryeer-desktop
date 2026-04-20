import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const repoRoot = resolve(desktopRoot, "..");
const backendModuleRoot = resolve(repoRoot, "queryeer-backend", "backend-plugin-devprobe");
const backendTargetDir = resolve(backendModuleRoot, "target");
const pluginRoot = resolve(repoRoot, "plugins", "dev-query-probe");
const pluginManifest = resolve(pluginRoot, "plugin.json");
const frontendModule = resolve(pluginRoot, "frontend", "module.mjs");
const pluginLibDir = resolve(pluginRoot, "lib");

function runBackendBuild() {
  const result = process.platform === "win32"
    ? spawnSync(
        "cmd.exe",
        [
          "/c",
          "mvnw.cmd",
          "-f",
          "queryeer-backend/pom.xml",
          "-pl",
          "backend-plugin-devprobe",
          "-DskipTests=true",
          "package"
        ],
        {
          cwd: repoRoot,
          stdio: "inherit"
        }
      )
    : spawnSync(
        resolve(repoRoot, "mvnw"),
        ["-f", "queryeer-backend/pom.xml", "-pl", "backend-plugin-devprobe", "-DskipTests=true", "package"],
        {
          cwd: repoRoot,
          stdio: "inherit"
        }
      );

  if (result.status !== 0) {
    throw new Error("Backend devprobe module build failed");
  }
}

function validateExternalPluginLayout() {
  if (!existsSync(pluginManifest)) {
    throw new Error(`Missing plugin manifest: ${pluginManifest}`);
  }
  if (!existsSync(frontendModule)) {
    throw new Error(`Missing frontend module: ${frontendModule}`);
  }
}

function stageBackendJars() {
  if (!existsSync(backendTargetDir)) {
    throw new Error(`Backend target directory not found: ${backendTargetDir}`);
  }

  const jarFiles = readdirSync(backendTargetDir)
    .filter((entry) => entry.endsWith(".jar") && !entry.endsWith("-sources.jar") && !entry.endsWith("-javadoc.jar"))
    .map((entry) => resolve(backendTargetDir, entry));

  if (jarFiles.length === 0) {
    throw new Error("No backend devprobe jars found after build");
  }

  rmSync(pluginLibDir, { recursive: true, force: true });
  mkdirSync(pluginLibDir, { recursive: true });

  for (const jarPath of jarFiles) {
    const fileName = jarPath.replace(/^.*[\\/]/, "");
    copyFileSync(jarPath, resolve(pluginLibDir, fileName));
  }
}

function main() {
  validateExternalPluginLayout();
  runBackendBuild();
  stageBackendJars();
  process.stdout.write(`Staged dev-query-probe plugin artifacts to ${pluginRoot}\n`);
}

main();

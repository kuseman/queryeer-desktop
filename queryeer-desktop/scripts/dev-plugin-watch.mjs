import { watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const repoRoot = resolve(desktopRoot, "..");
const backendModuleSrc = resolve(repoRoot, "queryeer-backend", "backend-plugin-devprobe", "src");
const externalPluginRoot = resolve(repoRoot, "plugins", "dev-query-probe");

let running = false;
let pending = false;

function runStage() {
  if (running) {
    pending = true;
    return;
  }

  running = true;
  const child = spawn("node", [resolve(scriptDir, "dev-plugin-stage.mjs")], {
    cwd: desktopRoot,
    stdio: "inherit"
  });

  child.on("exit", () => {
    running = false;
    if (pending) {
      pending = false;
      runStage();
    }
  });
}

function startWatcher(targetPath) {
  watch(targetPath, { recursive: true }, (_event, fileName) => {
    if (fileName && !fileName.includes("target") && !fileName.includes("lib")) {
      runStage();
    }
  });
}

runStage();
startWatcher(backendModuleSrc);
startWatcher(externalPluginRoot);
process.stdout.write("Watching dev-query-probe sources for changes...\n");

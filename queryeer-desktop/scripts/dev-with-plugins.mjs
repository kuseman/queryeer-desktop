import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const repoRoot = resolve(desktopRoot, "..");
const pluginPath = resolve(repoRoot, "plugins");

const child = process.platform === "win32"
  ? spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev"], {
      cwd: desktopRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        QUERYEER_PLUGINS_PATH: pluginPath
      }
    })
  : spawn("npm", ["run", "dev"], {
      cwd: desktopRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        QUERYEER_PLUGINS_PATH: pluginPath
      }
    });

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

const { execFileSync } = require("child_process");
const p = require("path");
const f = require("fs");

const name = p.basename(process.cwd());
const dir = p.join("dist", name);

f.mkdirSync(dir, { recursive: true });
f.copyFileSync(p.join("dist", "plugin.js"), p.join(dir, "plugin.js"));
f.rmSync(p.join("dist", "plugin.js"));

const manifest = JSON.parse(f.readFileSync("plugin.json", "utf8"));
manifest.frontend.entryModule = "./plugin.js";
f.writeFileSync(p.join(dir, "plugin.json"), JSON.stringify(manifest, null, 2));

const zipPath = p.join("dist", name + ".zip");
createZipFromDirectory(dir, zipPath);

console.log("=== Plugin ready in dist/" + name + "/ ===");
console.log("Copy dist/" + name + "/ to Queryeer's managed plugins directory");
console.log("ZIP package ready at dist/" + name + ".zip");

function createZipFromDirectory(sourceDir, outputZipPath) {
  const absoluteZipPath = p.resolve(outputZipPath);
  if (f.existsSync(outputZipPath)) {
    f.rmSync(outputZipPath, { force: true });
  }
  if (process.platform === "win32") {
    execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path * -DestinationPath '${absoluteZipPath.replace(/'/g, "''")}' -Force`], {
      cwd: sourceDir,
      stdio: "inherit"
    });
    return;
  }
  execFileSync("zip", ["-r", "-q", absoluteZipPath, "."], {
    cwd: sourceDir,
    stdio: "inherit"
  });
}

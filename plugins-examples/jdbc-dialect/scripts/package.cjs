const { execSync } = require("child_process");
const { execFileSync } = require("child_process");
const p = require("path");
const f = require("fs");

// Build backend via Maven wrapper
const mvnw = process.platform === "win32" ? "mvnw.cmd" : "./mvnw";
execSync("cd backend && " + mvnw + " clean package -DskipTests", {
  stdio: "inherit",
  shell: true
});

// Assemble dist/<name>/
const name = p.basename(process.cwd());
const dir = p.join("dist", name);

f.mkdirSync(dir, { recursive: true });

// Jar files go into lib/
const libDir = p.join(dir, "lib");
f.mkdirSync(libDir, { recursive: true });

const targetDir = p.join("backend", "target");
if (f.existsSync(targetDir)) {
  for (const file of f.readdirSync(targetDir)) {
    if (file.endsWith(".jar") && !file.includes("original")) {
      f.copyFileSync(p.join(targetDir, file), p.join(libDir, file));
    }
  }

  // Runtime dependency jars (copied by maven-dependency-plugin with includeScope=runtime)
  const depsDir = p.join(targetDir, "lib");
  if (f.existsSync(depsDir)) {
    for (const file of f.readdirSync(depsDir)) {
      if (file.endsWith(".jar")) {
        f.copyFileSync(p.join(depsDir, file), p.join(libDir, file));
      }
    }
  }
}

// Manifest (no frontend)
f.copyFileSync("plugin.json", p.join(dir, "plugin.json"));

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

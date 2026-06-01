const { execSync } = require("child_process");
const p = require("path");
const f = require("fs");

// Build backend via Maven wrapper
const mvnw = process.platform === "win32" ? "mvnw.cmd" : "./mvnw";
execSync("cd backend && " + mvnw + " clean package -DskipTests", {
  stdio: "inherit",
  shell: true
});

// Assemble dist/<name>/ (frontend already built by npm run build)
const name = p.basename(process.cwd());
const dir = p.join("dist", name);

if (f.existsSync(dir)) {
  f.rmSync(dir, { recursive: true, force: true });
}

f.mkdirSync(dir, { recursive: true });

// Frontend
f.copyFileSync(p.join("dist", "plugin.js"), p.join(dir, "plugin.js"));
f.rmSync(p.join("dist", "plugin.js"));

// Backend — jar files go into lib/
const libDir = p.join(dir, "lib");
f.mkdirSync(libDir, { recursive: true });

// Plugin jar (excluding original-xxx.jar)
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

// Manifest
const manifest = JSON.parse(f.readFileSync("plugin.json", "utf8"));
manifest.frontend.entryModule = "./plugin.js";
f.writeFileSync(p.join(dir, "plugin.json"), JSON.stringify(manifest, null, 2));

console.log("=== Plugin ready in dist/" + name + "/ ===");
console.log("Copy dist/" + name + "/ to Queryeer's managed plugins directory");

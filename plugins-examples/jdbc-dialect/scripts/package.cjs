const { execSync } = require("child_process");
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

console.log("=== Plugin ready in dist/" + name + "/ ===");
console.log("Copy dist/" + name + "/ to Queryeer's managed plugins directory");

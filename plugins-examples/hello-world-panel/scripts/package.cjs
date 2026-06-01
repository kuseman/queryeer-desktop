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

console.log("=== Plugin ready in dist/" + name + "/ ===");
console.log("Copy dist/" + name + "/ to Queryeer's managed plugins directory");

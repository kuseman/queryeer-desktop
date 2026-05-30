import { execSync } from "node:child_process";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(projectRoot, "..", "..", "..");
const releaseResources = resolve(join(projectRoot, "dist", "release-resources"));
const jlinkOutput = resolve(process.env.QUERYEER_JLINK_OUTPUT ?? join(repoRoot, ".backend-jlink-release"));
const builderArgs = process.argv.slice(2);
const releaseVersion = process.env.QUERYEER_RELEASE_VERSION?.trim();

function run(label, command, options = {}) {
  console.log(`\n[${label}]`);
  console.log(`  ${command}`);
  execSync(command, { cwd: projectRoot, stdio: "inherit", env: process.env, ...options });
}

process.env.QUERYEER_RELEASE_RESOURCES_DIR = releaseResources;
process.env.QUERYEER_JLINK_OUTPUT = jlinkOutput;
process.env.QUERYEER_CHANGELOG_FULL = "true";

run("Generate changelog", "node scripts/generate-changelog.mjs");
run("Build backend jlink runtime", "node scripts/backend-jlink.mjs");
run("Stage backend release resources", "node scripts/stage-backend-release.mjs");
run("Build desktop", "npm run build");
const versionArgs = releaseVersion ? [`--config.extraMetadata.version=${releaseVersion}`] : [];
run("Package desktop", ["npx", "electron-builder", "--publish", "never", ...versionArgs, ...builderArgs].join(" "));

console.log("\nRelease distribution build completed.");

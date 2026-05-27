import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const backendRoot = join(projectRoot, "..", "queryeer-backend");
const jlinkOutput = resolve(process.env.QUERYEER_JLINK_OUTPUT ?? join(projectRoot, "..", ".backend-jlink"));
const mvnw = process.platform === "win32" ? "mvnw.cmd" : "mvnw";
const mvnwPath = join(backendRoot, mvnw);

const backendModules = [
  "backend-runner",
  "backend-lib-queryengine-jdbc-foundation",
  "backend-lib-queryengine-sql-parser",
  "backend-plugin-jdbc",
  "backend-plugin-payloadbuilder",
  "backend-plugin-dialect-sqlserver",
  "backend-plugin-dialect-postgres"
];

function run(label, cmd, opts = {}) {
  console.log(`\n[${label}]`);
  console.log(`  ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: projectRoot, ...opts });
}

async function main() {
  if (!existsSync(mvnwPath)) {
    console.error(`Maven wrapper not found: ${mvnwPath}`);
    process.exit(1);
  }

  run("Maven build", [
    `"${mvnwPath}"`,
    "-q", "-T", "1C",
    "-f", `"${join(backendRoot, "pom.xml")}"`,
    "-pl", backendModules.join(","),
    "-am",
    "-DskipTests=true",
    "-Dspotless.check.skip=true",
    "-DcheckstyleSkip=true",
    "-Dmaven.javadoc.skip=true",
    "-Dmaven.source.skip=true",
    "install"
  ].join(" "));

  rmSync(jlinkOutput, { recursive: true, force: true });

  run("jlink", [
    "jlink",
    "--add-modules", "java.base,java.sql,java.management,java.net.http,java.xml,java.naming",
    `--output`, `"${jlinkOutput}"`,
    "--strip-debug",
    "--compress", "zip-6",
    "--no-header-files",
    "--no-man-pages"
  ].join(" "));

  const javaBin = join(jlinkOutput, "bin", process.platform === "win32" ? "java.exe" : "java");
  if (!existsSync(javaBin)) {
    console.error(`jlink image not created at: ${javaBin}`);
    process.exit(1);
  }

  console.log(`\nDone. jlink image created at: ${jlinkOutput}`);
  console.log(`Set QUERYEER_JLINK_HOME="${jlinkOutput}" and run the desktop dev server to use it.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

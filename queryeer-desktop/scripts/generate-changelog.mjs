import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(projectRoot, "..");
const outputPath = resolve(process.env.QUERYEER_CHANGELOG_OUTPUT ?? join(projectRoot, "dist", "generated", "CHANGELOG.md"));
const releaseVersion = (process.env.QUERYEER_RELEASE_VERSION ?? readPackageVersion()).trim();

function git(args, fallback = "") {
  try {
    return execSync(`git ${args}`, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return fallback;
  }
}

function readPackageVersion() {
  const raw = execSync("node -p \"JSON.parse(require('fs').readFileSync('package.json','utf8')).version\"", {
    cwd: projectRoot,
    encoding: "utf8"
  });
  return raw.trim();
}

function latestTagBeforeHead() {
  const tags = git("tag -l v* --sort=-version:refname");
  if (!tags) {
    return "";
  }
  for (const tag of tags.split(/\r?\n/)) {
    const taggedCommit = git(`rev-list -n 1 ${tag}`);
    const headCommit = git("rev-parse HEAD");
    if (taggedCommit && taggedCommit !== headCommit) {
      return tag;
    }
  }
  return "";
}

function categorize(subject) {
  if (/^feat(\(.+\))?:/i.test(subject)) {
    return "Features";
  }
  if (/^fix(\(.+\))?:/i.test(subject)) {
    return "Bug Fixes";
  }
  const chorePattern = /^chore(\(.+\))?:|^build(\(.+\))?:|^ci(\(.+\))?:|^docs(\(.+\))?:|^refactor(\(.+\))?:|^test(\(.+\))?:/i;
  if (chorePattern.test(subject)) {
    return "Chores";
  }
  return "Other Changes";
}

function formatSubject(subject) {
  return subject
    .replace(/^(feat|fix|chore|build|ci|docs|refactor|test)(\(.+\))?:\s*/i, "")
    .trim();
}

const fromTag = process.env.QUERYEER_CHANGELOG_FROM_REF?.trim() || latestTagBeforeHead();
const range = fromTag ? `${fromTag}..HEAD` : "HEAD";
const log = git(`log ${range} --pretty=format:%s`);
const categories = new Map([
  ["Features", []],
  ["Bug Fixes", []],
  ["Chores", []],
  ["Other Changes", []]
]);

for (const subject of log.split(/\r?\n/).filter(Boolean)) {
  if (/^release:|^chore: prepare for next development iteration/i.test(subject)) {
    continue;
  }
  categories.get(categorize(subject)).push(formatSubject(subject));
}

const lines = ["# Queryeer Changelog", "", `## ${releaseVersion}`, ""];
let wroteEntry = false;
for (const [title, entries] of categories) {
  if (entries.length === 0) {
    continue;
  }
  wroteEntry = true;
  lines.push(`### ${title}`, "");
  for (const entry of entries) {
    lines.push(`- ${entry}`);
  }
  lines.push("");
}
if (!wroteEntry) {
  lines.push("- Release build", "");
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${lines.join("\n").trim()}\n`, "utf8");
console.log(`Generated changelog: ${outputPath}`);
console.log(`Release version: ${releaseVersion}`);
if (fromTag) {
  console.log(`Changelog range: ${fromTag}..HEAD`);
}

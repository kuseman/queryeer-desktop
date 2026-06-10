import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(projectRoot, "..", "..", "..");
const outputPath = resolve(process.env.QUERYEER_CHANGELOG_OUTPUT ?? join(projectRoot, "dist", "generated", "CHANGELOG.md"));

function git(args, fallback = "") {
  try {
    return execSync(`git ${args}`, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return fallback;
  }
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

function commitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  const log = git(`log ${range} --pretty=format:%s`);
  return parseCommits(log);
}

function commitsBetween(fromTag, toTag) {
  const range = fromTag ? `${fromTag}..${toTag}` : toTag;
  const log = git(`log ${range} --pretty=format:%s`);
  return parseCommits(log);
}

function parseCommits(raw) {
  const categories = new Map([
    ["Features", []],
    ["Bug Fixes", []],
    ["Chores", []],
    ["Other Changes", []]
  ]);
  for (const subject of raw.split(/\r?\n/).filter(Boolean)) {
    const entries = splitConventionalCommits(subject);
    for (const entry of entries) {
      if (/^release:|^chore: prepare for next development iteration/i.test(entry)) {
        continue;
      }
      categories.get(categorize(entry)).push(formatSubject(entry));
    }
  }
  return categories;
}

/** Split a commit subject line that may contain multiple conventional commits concatenated together. */
function splitConventionalCommits(subject) {
  const parts = subject.split(/\s(?=(?:feat|fix|chore|build|ci|docs|refactor|test)(?:\([^)]*\))?:\s)/);
  const result = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed && /^(?:feat|fix|chore|build|ci|docs|refactor|test)/i.test(trimmed)) {
      result.push(trimmed);
    }
  }
  return result.length > 0 ? result : [subject];
}

function writeReleaseSection(lines, version, categories) {
  const hasEntries = [...categories.values()].some((e) => e.length > 0);
  lines.push("", `## ${version}`, "");
  if (!hasEntries) {
    lines.push("- Release build", "");
    return;
  }
  for (const [title, entries] of categories) {
    if (entries.length === 0) {
      continue;
    }
    lines.push(`### ${title}`, "");
    for (const entry of entries) {
      lines.push(`- ${entry}`);
    }
    lines.push("");
  }
}

function generateForGithubRelease() {
  const releaseVersion = (process.env.QUERYEER_RELEASE_VERSION ?? readPackageVersion()).trim();
  const fromTag = process.env.QUERYEER_CHANGELOG_FROM_REF?.trim() || latestTagBeforeHead();
  const categories = fromTag ? commitsBetween(fromTag, "HEAD") : commitsSince("");
  const lines = ["# Queryeer Changelog"];
  writeReleaseSection(lines, releaseVersion, categories);
  writeChangelog(lines);
  console.log(`Generated changelog: ${outputPath}`);
  console.log(`Release version: ${releaseVersion}`);
  if (fromTag) {
    console.log(`Changelog range: ${fromTag}..HEAD`);
  }
}

function generateFullChangelog() {
  const allTags = git("tag -l v* --sort=-version:refname").split(/\r?\n/).filter(Boolean);
  const lines = ["# Queryeer Changelog"];
  if (allTags.length === 0) {
    const categories = commitsSince("");
    writeReleaseSection(lines, readPackageVersion(), categories);
  } else {
    for (let i = 0; i < allTags.length; i++) {
      const tag = allTags[i];
      const fromTag = i + 1 < allTags.length ? allTags[i + 1] : "";
      const categories = commitsBetween(fromTag, tag);
      writeReleaseSection(lines, tag, categories);
    }
    const headCommits = commitsSince(allTags[0]);
    const hasHeadCommits = [...headCommits.values()].some((e) => e.length > 0);
    if (hasHeadCommits) {
      writeReleaseSection(lines, readPackageVersion(), headCommits);
    }
  }
  writeChangelog(lines);
  console.log(`Generated full changelog: ${outputPath}`);
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

function writeChangelog(lines) {
  const content = lines.join("\n").trim() + "\n";
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, "utf8");
}

// Main
if (process.env.QUERYEER_CHANGELOG_FULL === "true") {
  generateFullChangelog();
} else {
  generateForGithubRelease();
}

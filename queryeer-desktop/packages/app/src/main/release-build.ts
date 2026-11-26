import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Whether this is a release build: packaged by the release workflow, which sets `queryeerRelease` in the packaged
 * `package.json` (scripts/dist-release.mjs). Only then is the version the app reports the one it is; a development
 * run or a local package reports the last release's version.
 */
export function isReleaseBuild(appPath: string, isPackaged: boolean): boolean {
  if (!isPackaged) {
    return false;
  }
  try {
    const metadata = JSON.parse(readFileSync(join(appPath, "package.json"), "utf8")) as { queryeerRelease?: unknown };
    // electron-builder's command line may pass it as a string
    return metadata.queryeerRelease === true || metadata.queryeerRelease === "true";
  } catch {
    return false;
  }
}

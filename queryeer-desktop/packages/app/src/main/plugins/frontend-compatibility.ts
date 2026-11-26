import type { ExternalFrontendPluginManifest } from "@queryeer/api/plugin/ExternalFrontendPluginManifest.js";
import { satisfies } from "./semver.js";

/**
 * Why a plugin's frontend can't run on this Queryeer, or undefined when it can. `apiVersion` is `frontend.apiVersion`
 * from its `plugin.json`, a range on Queryeer's version (the `@queryeer/api` it was built for, e.g. `>=0.24.0 <1.0.0`).
 * A plugin that declares none is not checked.
 */
export function frontendApiProblem(apiVersion: string | undefined, appVersion: string): string | undefined {
  if (apiVersion === undefined || apiVersion.trim().length === 0) {
    return undefined;
  }
  try {
    return satisfies(appVersion, apiVersion) ? undefined : `Needs Queryeer ${apiVersion}, but this is ${appVersion}`;
  } catch (error) {
    return `Cannot check frontend.apiVersion '${apiVersion}': ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Marks the frontends that can't run on this Queryeer with a `skipReason`, which the renderer reports instead of loading
 * them. Enforced only in a release build (`isReleaseBuild`): a development run or a local package reports the version of
 * the last release, so plugins built for the one in development would otherwise be skipped (the backend does the same
 * for its `-SNAPSHOT`). Otherwise it only warns.
 */
export function checkFrontendCompatibility(
  manifests: ExternalFrontendPluginManifest[],
  appVersion: string,
  enforce: boolean,
  warn: (message: string) => void = console.warn
): ExternalFrontendPluginManifest[] {
  return manifests.map((manifest) => {
    const problem = frontendApiProblem(manifest.apiVersion, appVersion);
    if (problem === undefined) {
      return manifest;
    }
    if (!enforce) {
      warn(`[plugins] ${manifest.id}: ${problem}; a development build doesn't enforce it`);
      return manifest;
    }
    return { ...manifest, skipReason: problem };
  });
}

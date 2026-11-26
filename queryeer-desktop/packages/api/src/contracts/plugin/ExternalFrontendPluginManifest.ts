export type ExternalFrontendPluginManifest = {
  id: string;
  name: string;
  version: string;
  /** From `plugin.json`, when it has one. */
  description?: string;
  modulePath: string;
  sourcePath: string;
  /** `frontend.apiVersion` from `plugin.json`: the Queryeer versions the frontend runs on, an npm-style range. Since 0.24 */
  apiVersion?: string;
  /** Set when the frontend can't run on this Queryeer (e.g. `apiVersion` doesn't match): it isn't loaded, and this is reported. Since 0.24 */
  skipReason?: string;
};

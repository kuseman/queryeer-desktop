export const BUNDLED_PLUGINS_LOCK_FILE: string;

export type BundleTarget = { appVersion?: string; javaFeatureVersion: number };

export type CatalogVersion = {
  version: string;
  prerelease?: boolean;
  url: string;
  sha256: string;
  size?: number;
  manifest?: Record<string, unknown>;
};

export type Catalog = { schemaVersion: number; plugins: { id: string; versions: CatalogVersion[] }[] };

export type SelectedVersion = {
  id: string;
  version: string;
  url: string;
  sha256: string;
  size?: number;
  passedOver: { version: string; prerelease: boolean; reason: string }[];
};

export type LockedPlugin = { id: string; version: string; file: string; sha256: string; url?: string };

export function javaFeatureVersion(javaHome: string): number;

export function versionProblem(
  entry: CatalogVersion,
  target: BundleTarget,
  bundledVersionOf?: (id: string) => string | null | undefined
): string | undefined;

export function selectBundledVersions(catalog: unknown, ids: string[], target: BundleTarget, leaveOut?: (problem: string) => void): SelectedVersion[];

export function readSource(source: string): Promise<Buffer>;

export function bundleFromCatalog(options: {
  catalog: unknown;
  ids: string[];
  target: BundleTarget;
  outDir: string;
  leaveOut?: (problem: string) => void;
  read?: (source: string) => Promise<Buffer>;
  log?: (line: string) => void;
}): Promise<LockedPlugin[]>;

export function copyBundle(options: { sourceDir: string; ids: string[]; outDir: string; log?: (line: string) => void }): LockedPlugin[];

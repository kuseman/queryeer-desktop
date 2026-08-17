export type JdbcManagedDriverContribution = {
  dialectId: string;
  displayName: string;
  groupId: string;
  artifactId: string;
  driverClassName: string;
  compatibleVersionRegex?: string;
  downloadPageUrl?: string;
  companionArtifacts?: JdbcDriverCompanionArtifact[];
};

export type JdbcDriverPlatform = {
  os: "windows" | "linux" | "macos";
  arch: "x64" | "x86" | "arm64";
};

export type JdbcDriverGitHubReleaseArchiveSource = {
  type: "githubReleaseArchive";
  repository: `${string}/${string}`;
  releaseTagTemplate: string;
  assetName: string;
  driverVersionToReleaseVersion: { pattern: string; replacement: string };
  archiveEntryTemplate: string;
};

export type JdbcDriverCompanionArtifact = {
  id: string;
  displayName: string;
  kind: "nativeLibrary";
  platforms: JdbcDriverPlatform[];
  source: JdbcDriverGitHubReleaseArchiveSource;
  targetDirectory: "libNative";
  expectedFileExtension: ".dll";
  versionLockedToDriver?: boolean;
};

export type RegisteredJdbcManagedDriverContribution = JdbcManagedDriverContribution & {
  readonly ownerPluginId: string;
};

export type JdbcDriverSource = "missing" | "manual" | "managed";

export type JdbcDriverPendingOperation = "install" | "update" | "remove";

export type JdbcDriverDisabledArtifactStatus = {
  artifactId: string;
  fileName: string;
  source: Exclude<JdbcDriverSource, "missing">;
  version?: string;
};

export type JdbcDriverDisabledSetStatus = {
  id: string;
  version?: string;
  disabledAt: string;
  reason: string;
  pendingRestore: boolean;
  restorable: boolean;
  artifacts: JdbcDriverDisabledArtifactStatus[];
};

export type JdbcDriverArtifactStatus = {
  id: string;
  displayName: string;
  kind: "driver" | "nativeLibrary";
  applicable: boolean;
  source: JdbcDriverSource;
  installedVersion?: string;
  latestVersion?: string;
  updateAvailable: boolean;
  restartRequired: boolean;
  managementAvailable: boolean;
  managedWithPrimary?: boolean;
  versionMismatch?: boolean;
  warning?: string;
  pendingOperation?: JdbcDriverPendingOperation;
  error?: string;
};

export type JdbcDriverStatus = {
  contribution: RegisteredJdbcManagedDriverContribution;
  source: JdbcDriverSource;
  installedVersion?: string;
  latestVersion?: string;
  updateAvailable: boolean;
  restartRequired: boolean;
  managementAvailable: boolean;
  versionMismatch?: boolean;
  warning?: string;
  artifacts?: JdbcDriverArtifactStatus[];
  disabledSets?: JdbcDriverDisabledSetStatus[];
  pendingOperation?: JdbcDriverPendingOperation;
  lastCheckedAt?: string;
  error?: string;
};

export type JdbcDriverOperationResult = {
  accepted: boolean;
  reason?: string;
  status: JdbcDriverStatus;
};

export type JdbcDriverBackendRestartResult = {
  accepted: boolean;
  reason?: string;
};

export type JdbcDriverSubscriber = (drivers: readonly RegisteredJdbcManagedDriverContribution[]) => void;

export type JdbcDriverRegistry = {
  registerDriver: (contribution: JdbcManagedDriverContribution) => void;
  listDrivers: () => readonly RegisteredJdbcManagedDriverContribution[];
  getDriver: (dialectId: string) => RegisteredJdbcManagedDriverContribution | undefined;
  subscribe: (subscriber: JdbcDriverSubscriber) => () => void;
};

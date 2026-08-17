import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import JSZip from "jszip";
import type {
  JdbcDriverArtifactStatus,
  JdbcDriverCompanionArtifact,
  JdbcDriverDisabledSetStatus,
  JdbcDriverOperationResult,
  JdbcDriverPendingOperation,
  JdbcDriverStatus,
  RegisteredJdbcManagedDriverContribution
} from "@queryeer/api/queryengine/JdbcDriverExtension.js";

const MAVEN_ORIGIN = "https://repo.maven.apache.org";
const MAVEN_ROOT = `${MAVEN_ORIGIN}/maven2`;
const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_DOWNLOAD_HOSTS = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const MANAGED_PREFIX = "000-queryeer-managed-";
const INVENTORY_VERSION = 2;

type PendingEntry = {
  operation: JdbcDriverPendingOperation;
  bundleId?: string;
  bundleSize?: number;
  version?: string;
  sha256?: string;
  stagedFile?: string;
  finalFile?: string;
};

type InventoryEntry = {
  ownerPluginId: string;
  dialectId: string;
  installedVersion?: string;
  installedSha256?: string;
  managedFile?: string;
  latestVersion?: string;
  lastCheckedAt?: string;
  error?: string;
  pending?: PendingEntry;
  companions?: CompanionInventoryEntry[];
};

type CompanionInventoryEntry = Omit<InventoryEntry, "ownerPluginId" | "dialectId" | "companions"> & { id: string };

type DisabledArtifactEntry = {
  artifactId: string;
  kind: "driver" | "nativeLibrary";
  source: "manual" | "managed";
  version?: string;
  sha256: string;
  originalFile: string;
  disabledFile: string;
};

type DisabledSetEntry = {
  id: string;
  ownerPluginId: string;
  dialectId: string;
  version?: string;
  disabledAt: string;
  reason: string;
  pendingDisable?: boolean;
  pendingRestore?: boolean;
  restoreDisplacedSetIds?: string[];
  artifacts: DisabledArtifactEntry[];
};

type InventoryDocument = {
  version: 2;
  drivers: InventoryEntry[];
  disabledSets: DisabledSetEntry[];
};

type ActiveArtifactCandidate = {
  contribution: RegisteredJdbcManagedDriverContribution;
  artifactId: string;
  kind: "driver" | "nativeLibrary";
  source: "manual" | "managed";
  version?: string;
  sha256: string;
  ambiguous?: boolean;
  file: string;
};

const TRUSTED_CONTRIBUTIONS: readonly RegisteredJdbcManagedDriverContribution[] = [
  {
    ownerPluginId: "core.queryengine.jdbc.postgres",
    dialectId: "postgres",
    groupId: "org.postgresql",
    artifactId: "postgresql",
    driverClassName: "org.postgresql.Driver",
    displayName: "PostgreSQL JDBC Driver",
    downloadPageUrl: "https://jdbc.postgresql.org/download/"
  },
  {
    ownerPluginId: "core.queryengine.jdbc.sqlserver",
    dialectId: "sqlserver",
    groupId: "com.microsoft.sqlserver",
    artifactId: "mssql-jdbc",
    driverClassName: "com.microsoft.sqlserver.jdbc.SQLServerDriver",
    displayName: "Microsoft JDBC Driver for SQL Server",
    compatibleVersionRegex: "\\.jre11$",
    downloadPageUrl: "https://learn.microsoft.com/sql/connect/jdbc/download-microsoft-jdbc-driver-for-sql-server",
    companionArtifacts: [{
      id: "native-auth",
      displayName: "Windows Native Authentication",
      kind: "nativeLibrary",
      platforms: [{ os: "windows", arch: "x64" }, { os: "windows", arch: "x86" }],
      source: {
        type: "githubReleaseArchive",
        repository: "microsoft/mssql-jdbc",
        releaseTagTemplate: "v{releaseVersion}",
        assetName: "mssql-jdbc_auth.zip",
        driverVersionToReleaseVersion: {
          pattern: "^([0-9]+\\.[0-9]+\\.[0-9]+)\\.jre[0-9]+$",
          replacement: "$1"
        },
        archiveEntryTemplate: "{arch}/mssql-jdbc_auth-{releaseVersion}.{arch}.dll"
      },
      targetDirectory: "libNative",
      expectedFileExtension: ".dll",
      versionLockedToDriver: true
    }]
  },
  {
    ownerPluginId: "core.queryengine.jdbc.sqlite",
    dialectId: "sqlite",
    groupId: "org.xerial",
    artifactId: "sqlite-jdbc",
    driverClassName: "org.sqlite.JDBC",
    displayName: "SQLite JDBC Driver",
    downloadPageUrl: "https://github.com/xerial/sqlite-jdbc/releases"
  }
];

export function defaultJdbcDriverInventoryPath(settingsDir: string): string {
  return join(settingsDir, "jdbc-drivers.json");
}

export class JdbcDriverArtifactService {
  private inventory: InventoryDocument = { version: INVENTORY_VERSION, drivers: [], disabledSets: [] };
  private readonly libSharedDir: string;
  private readonly libNativeDir: string;
  private readonly stagingDir: string;
  private readonly inventoryPath: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly moveArtifact: typeof rename;
  private readonly trashArtifact: (path: string) => Promise<void>;
  private mutationQueue: Promise<void> = Promise.resolve();

  public constructor(options: {
    appDir: string;
    settingsDir: string;
    fetch?: typeof fetch;
    timeoutMs?: number;
    now?: () => Date;
    platform?: NodeJS.Platform;
    arch?: string;
    moveArtifact?: typeof rename;
    trashArtifact?: (path: string) => Promise<void>;
  }) {
    this.libSharedDir = join(options.appDir, "libShared");
    this.libNativeDir = join(options.appDir, "libNative");
    this.stagingDir = join(this.libSharedDir, ".jdbc-staging");
    this.inventoryPath = defaultJdbcDriverInventoryPath(options.settingsDir);
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.now = options.now ?? (() => new Date());
    this.platform = options.platform ?? process.platform;
    this.arch = normalizeArch(options.arch ?? process.arch);
    this.moveArtifact = options.moveArtifact ?? rename;
    this.trashArtifact = options.trashArtifact ?? ((path) => rm(path));
  }

  public async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.libSharedDir, { recursive: true }),
      mkdir(this.libNativeDir, { recursive: true }),
      mkdir(this.stagingDir, { recursive: true }),
      mkdir(dirname(this.inventoryPath), { recursive: true })
    ]);
    this.inventory = await this.readInventory();
    await this.applyPending();
  }

  public applyPending(): Promise<void> {
    return this.enqueueMutation(async () => {
      await this.applyPendingInternal();
      await this.reconcileConflictingArtifacts();
    });
  }

  private async applyPendingInternal(): Promise<void> {
    let changed = await this.recoverPendingDisabledSets();
    for (const disabledSet of [...this.inventory.disabledSets]) {
      if (!disabledSet.pendingRestore) continue;
      await this.applyDisabledSetRestore(disabledSet);
      changed = true;
    }
    const bundled = new Map<string, Array<InventoryEntry | CompanionInventoryEntry>>();
    for (const driverEntry of this.inventory.drivers) {
      for (const entry of [driverEntry, ...(driverEntry.companions ?? [])]) {
        const pending = entry.pending;
        if (!pending) continue;
        if (pending.bundleId) {
          const members = bundled.get(pending.bundleId) ?? [];
          members.push(entry);
          bundled.set(pending.bundleId, members);
          continue;
        }

        if (pending.operation === "remove") {
          if (entry.managedFile && this.isManagedPath(entry.managedFile)) {
            await rm(entry.managedFile, { force: true });
          }
          entry.managedFile = undefined;
          entry.installedVersion = undefined;
          entry.installedSha256 = undefined;
          entry.pending = undefined;
          changed = true;
          continue;
        }

        if (!pending.stagedFile || !pending.finalFile || !pending.sha256 || !this.isStagedPath(pending.stagedFile)
          || !this.isManagedPath(pending.finalFile)) {
          entry.error = "Pending JDBC driver operation is invalid";
          entry.pending = undefined;
          changed = true;
          continue;
        }
        if (existsSync(pending.finalFile)) {
          const finalHash = await fileSha256(pending.finalFile);
          if (finalHash !== pending.sha256) {
            entry.error = `JDBC driver target '${basename(pending.finalFile)}' already exists`;
            await rm(pending.stagedFile, { force: true });
            entry.pending = undefined;
            changed = true;
            continue;
          }
          await rm(pending.stagedFile, { force: true });
        } else {
          if (!existsSync(pending.stagedFile)) {
            entry.error = "Staged JDBC driver is missing";
            entry.pending = undefined;
            changed = true;
            continue;
          }
          await rename(pending.stagedFile, pending.finalFile);
        }
        const oldFile = entry.managedFile;
        entry.managedFile = pending.finalFile;
        entry.installedVersion = pending.version;
        entry.installedSha256 = pending.sha256;
        entry.error = undefined;
        entry.pending = undefined;
        if (oldFile && oldFile !== entry.managedFile && this.isManagedPath(oldFile)) {
          await rm(oldFile, { force: true });
        }
        changed = true;
      }
    }
    for (const [bundleId, members] of bundled) {
      await this.applyPendingBundle(bundleId, members);
      changed = true;
    }
    if (changed) await this.writeInventory();
  }

  private async applyPendingBundle(bundleId: string, members: Array<InventoryEntry | CompanionInventoryEntry>): Promise<void> {
    const pendingMembers = members.map((entry) => ({ entry, pending: entry.pending! }));
    if (pendingMembers.length < 2 || pendingMembers.some(({ pending }) => pending.bundleId !== bundleId
      || pending.bundleSize !== pendingMembers.length
      || pending.operation !== pendingMembers[0].pending.operation)) {
      throw new Error(`Pending JDBC bundle '${bundleId}' is incomplete`);
    }
    if (pendingMembers[0].pending.operation === "remove") {
      const moved: Array<{ original: string; staged: string }> = [];
      try {
        for (let index = 0; index < pendingMembers.length; index += 1) {
          const managedFile = pendingMembers[index].entry.managedFile;
          if (!managedFile || !this.isManagedPath(managedFile)) continue;
          const extension = managedFile.toLowerCase().endsWith(".dll") ? ".dll" : ".jar";
          const staged = join(this.stagingDir, `${bundleId}-remove-${index}${extension}`);
          if (!existsSync(managedFile)) {
            if (existsSync(staged)) moved.push({ original: managedFile, staged });
            continue;
          }
          await this.moveArtifact(managedFile, staged);
          moved.push({ original: managedFile, staged });
        }
      } catch (error) {
        for (const move of [...moved].reverse()) {
          if (existsSync(move.staged) && !existsSync(move.original)) await this.moveArtifact(move.staged, move.original);
        }
        throw error;
      }
      for (const { entry } of pendingMembers) {
        entry.managedFile = undefined;
        entry.installedVersion = undefined;
        entry.installedSha256 = undefined;
        entry.error = undefined;
        entry.pending = undefined;
      }
      await Promise.allSettled(moved.map((move) => rm(move.staged, { force: true })));
      return;
    }

    for (const { pending } of pendingMembers) {
      if (!pending.stagedFile || !pending.finalFile || !pending.sha256 || !this.isStagedPath(pending.stagedFile)
        || !this.isManagedPath(pending.finalFile)) throw new Error(`Pending JDBC bundle '${bundleId}' is invalid`);
      if (existsSync(pending.finalFile)) {
        if (await fileSha256(pending.finalFile) !== pending.sha256) {
          throw new Error(`JDBC bundle target '${basename(pending.finalFile)}' already exists`);
        }
      } else if (!existsSync(pending.stagedFile) || await fileSha256(pending.stagedFile) !== pending.sha256) {
        throw new Error(`Staged JDBC bundle member '${basename(pending.stagedFile)}' is missing or invalid`);
      }
    }

    const oldFiles = pendingMembers.map(({ entry }) => entry.managedFile);
    const promoted = pendingMembers
      .filter(({ entry, pending }) => pending.finalFile !== entry.managedFile && existsSync(pending.finalFile!)
        && !existsSync(pending.stagedFile!))
      .map(({ pending }) => ({ finalFile: pending.finalFile!, stagedFile: pending.stagedFile! }));
    try {
      for (const { pending } of pendingMembers) {
        if (!existsSync(pending.finalFile!)) {
          await this.moveArtifact(pending.stagedFile!, pending.finalFile!);
          promoted.push({ finalFile: pending.finalFile!, stagedFile: pending.stagedFile! });
        }
      }
    } catch (error) {
      for (const promotion of [...promoted].reverse()) {
        if (existsSync(promotion.finalFile) && !existsSync(promotion.stagedFile)) {
          await this.moveArtifact(promotion.finalFile, promotion.stagedFile);
        }
      }
      throw error;
    }
    const quarantined: Array<{ original: string; staged: string }> = [];
    try {
      for (let index = 0; index < oldFiles.length; index += 1) {
        const oldFile = oldFiles[index];
        if (!oldFile || pendingMembers.some(({ pending }) => pending.finalFile === oldFile) || !this.isManagedPath(oldFile)) continue;
        const extension = oldFile.toLowerCase().endsWith(".dll") ? ".dll" : ".jar";
        const staged = join(this.stagingDir, `${bundleId}-old-${index}${extension}`);
        if (!existsSync(oldFile)) {
          if (existsSync(staged)) quarantined.push({ original: oldFile, staged });
          continue;
        }
        await this.moveArtifact(oldFile, staged);
        quarantined.push({ original: oldFile, staged });
      }
    } catch (error) {
      for (const move of [...quarantined].reverse()) {
        if (existsSync(move.staged) && !existsSync(move.original)) await this.moveArtifact(move.staged, move.original);
      }
      for (const promotion of [...promoted].reverse()) {
        if (existsSync(promotion.finalFile) && !existsSync(promotion.stagedFile)) {
          await this.moveArtifact(promotion.finalFile, promotion.stagedFile);
        }
      }
      throw error;
    }
    await Promise.all(pendingMembers.map(({ pending }) => rm(pending.stagedFile!, { force: true })));
    for (const { entry, pending } of pendingMembers) {
      entry.managedFile = pending.finalFile;
      entry.installedVersion = pending.version;
      entry.installedSha256 = pending.sha256;
      entry.error = undefined;
      entry.pending = undefined;
    }
    await Promise.allSettled(quarantined.map((move) => rm(move.staged, { force: true })));
  }

  private async reconcileConflictingArtifacts(): Promise<void> {
    const candidates = await this.scanActiveArtifactCandidates([...TRUSTED_CONTRIBUTIONS]);
    const disabledSets: DisabledSetEntry[] = [];
    for (const contribution of TRUSTED_CONTRIBUTIONS) {
      const providerCandidates = candidates.filter((candidate) => candidate.contribution.dialectId === contribution.dialectId);
      const disabled: ActiveArtifactCandidate[] = [];
      const driverCandidates = providerCandidates.filter((candidate) => candidate.kind === "driver");
      const inventoryEntry = this.findEntry(contribution);
      const selectedManagedDriver = inventoryEntry?.managedFile && existsSync(inventoryEntry.managedFile)
        ? driverCandidates.find((candidate) => candidate.file === inventoryEntry.managedFile && !candidate.ambiguous
          && candidate.sha256 === inventoryEntry.installedSha256)
        : undefined;
      const selectedDriver = selectedManagedDriver
        ?? this.selectManualCandidate(driverCandidates.filter((candidate) => candidate.source === "manual" && !candidate.ambiguous), contribution);
      disabled.push(...driverCandidates.filter((candidate) => candidate !== selectedDriver));

      for (const companion of contribution.companionArtifacts ?? []) {
        if (!this.isApplicable(companion)) continue;
        const companionCandidates = providerCandidates.filter((candidate) => candidate.artifactId === companion.id);
        const companionEntry = inventoryEntry ? this.findCompanionEntry(inventoryEntry, companion.id) : undefined;
        let selectedCompanion: ActiveArtifactCandidate | undefined;
        if (selectedDriver?.version) {
          let releaseVersion: string | undefined;
          try {
            releaseVersion = this.releaseVersion(companion, selectedDriver.version);
          } catch {
            releaseVersion = undefined;
          }
          if (releaseVersion) {
            const selectedManagedCompanion = companionEntry?.managedFile && existsSync(companionEntry.managedFile)
              ? companionCandidates.find((candidate) => candidate.file === companionEntry.managedFile
                && candidate.version === releaseVersion && candidate.sha256 === companionEntry.installedSha256)
              : undefined;
            const matchingManual = companionCandidates.filter((candidate) => candidate.source === "manual"
              && candidate.version === releaseVersion);
            selectedCompanion = selectedManagedCompanion ?? (matchingManual.length === 1 ? matchingManual[0] : undefined);
          }
        }
        disabled.push(...companionCandidates.filter((candidate) => candidate !== selectedCompanion));
      }
      if (disabled.length > 0) {
        const reason = selectedDriver
          ? "Disabled because another artifact was selected for this JDBC provider."
          : "Disabled because conflicting provider artifacts could not be resolved safely.";
        disabledSets.push(...await this.prepareDisabledSets(disabled, reason));
      }
    }
    if (disabledSets.length === 0) return;
    for (const disabledSet of disabledSets) disabledSet.pendingDisable = true;
    this.inventory.disabledSets.push(...disabledSets);
    await this.writeInventory();
    const moved: Array<{ original: string; disabled: string }> = [];
    try {
      for (const disabledSet of disabledSets) {
        for (const artifact of disabledSet.artifacts) {
          await this.completeMove(artifact.originalFile, artifact.disabledFile, artifact.sha256);
          moved.push({ original: artifact.originalFile, disabled: artifact.disabledFile });
        }
      }
    } catch (error) {
      for (const move of [...moved].reverse()) {
        if (existsSync(move.disabled) && !existsSync(move.original)) await this.moveArtifact(move.disabled, move.original);
      }
      this.inventory.disabledSets = this.inventory.disabledSets.filter((entry) => !disabledSets.includes(entry));
      await this.writeInventory();
      throw error;
    }
    for (const disabledSet of disabledSets) disabledSet.pendingDisable = undefined;
    await this.writeInventory();
  }

  private async scanActiveArtifactCandidates(
    contributions: RegisteredJdbcManagedDriverContribution[]
  ): Promise<ActiveArtifactCandidate[]> {
    const result: ActiveArtifactCandidate[] = [];
    let jarNames: string[] = [];
    try {
      jarNames = (await readdir(this.libSharedDir)).filter((name) => name.toLowerCase().endsWith(".jar")).sort();
    } catch {
      // Missing directories have no active artifacts.
    }
    for (const name of jarNames) {
      const file = join(this.libSharedDir, name);
      let contents: Buffer;
      try {
        contents = await readFile(file);
      } catch {
        continue;
      }
      const sha256 = createHash("sha256").update(contents).digest("hex");
      try {
        const archive = await JSZip.loadAsync(contents);
        const matched = contributions.filter((contribution) => archive.file(classEntry(contribution.driverClassName)));
        if (matched.length > 1) {
          const contribution = matched[0];
          result.push({ contribution, artifactId: contribution.artifactId, kind: "driver", source: "manual", sha256, ambiguous: true, file });
        } else if (matched.length === 1) {
          const contribution = matched[0];
          result.push({
            contribution,
            artifactId: contribution.artifactId,
            kind: "driver",
            source: name.startsWith(MANAGED_PREFIX) ? "managed" : "manual",
            version: await readJarVersion(archive, name, contribution.artifactId),
            sha256,
            file
          });
        }
      } catch {
        const contribution = contributions.find((candidate) => name.startsWith(`${MANAGED_PREFIX}${candidate.artifactId}-`));
        if (contribution) {
          result.push({ contribution, artifactId: contribution.artifactId, kind: "driver", source: "managed", sha256, ambiguous: true, file });
        }
      }
    }
    let nativeNames: string[] = [];
    try {
      nativeNames = (await readdir(this.libNativeDir)).filter((name) => /^(?:mssql-jdbc_auth.*|sqljdbc_auth)\.dll$/i.test(name)).sort();
    } catch {
      // Missing directories have no active artifacts.
    }
    for (const contribution of contributions) {
      for (const companion of contribution.companionArtifacts ?? []) {
        if (!this.isApplicable(companion)) continue;
        for (const name of nativeNames) {
          const file = join(this.libNativeDir, name);
          result.push({
            contribution,
            artifactId: companion.id,
            kind: "nativeLibrary",
            source: name.includes(".queryeer-managed.") ? "managed" : "manual",
            version: name.match(/^mssql-jdbc_auth-([0-9]+\.[0-9]+\.[0-9]+)(?:\.[^.]+)?(?:\.queryeer-managed)?\.dll$/i)?.[1],
            sha256: await fileSha256(file),
            file
          });
        }
      }
    }
    return result;
  }

  private selectManualCandidate(
    candidates: ActiveArtifactCandidate[],
    contribution: RegisteredJdbcManagedDriverContribution
  ): ActiveArtifactCandidate | undefined {
    if (candidates.length === 1) return candidates[0];
    if (candidates.length === 0 || candidates.some((candidate) => !candidate.version)) return undefined;
    const compatible = contribution.compatibleVersionRegex
      ? candidates.filter((candidate) => new RegExp(contribution.compatibleVersionRegex!).test(candidate.version!))
      : candidates;
    return compatible.sort((left, right) => compareVersions(right.version!, left.version!))[0];
  }

  private async prepareDisabledSets(candidates: ActiveArtifactCandidate[], reason: string): Promise<DisabledSetEntry[]> {
    const remainingNative = candidates.filter((candidate) => candidate.kind === "nativeLibrary");
    const groups: ActiveArtifactCandidate[][] = candidates
      .filter((candidate) => candidate.kind === "driver")
      .map((driver) => {
        const version = this.disabledSetVersion(driver);
        const nativeIndex = remainingNative.findIndex((candidate) => candidate.contribution.dialectId === driver.contribution.dialectId
          && this.disabledSetVersion(candidate) === version);
        return nativeIndex >= 0 ? [driver, ...remainingNative.splice(nativeIndex, 1)] : [driver];
      });
    groups.push(...remainingNative.map((candidate) => [candidate]));
    const disabledAt = this.now().toISOString();
    const result: DisabledSetEntry[] = [];
    for (const group of groups) {
      const id = `${group[0].contribution.dialectId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const artifacts: DisabledArtifactEntry[] = [];
      for (const candidate of group) {
        const disabledRoot = candidate.kind === "driver" ? this.libSharedDir : this.libNativeDir;
        const disabledFile = join(disabledRoot, "disabled", candidate.contribution.dialectId, id, basename(candidate.file));
        await mkdir(dirname(disabledFile), { recursive: true });
        artifacts.push({
          artifactId: candidate.artifactId,
          kind: candidate.kind,
          source: candidate.source,
          ...(candidate.version ? { version: candidate.version } : {}),
          sha256: candidate.sha256,
          originalFile: candidate.file,
          disabledFile
        });
      }
      result.push({
        id,
        ownerPluginId: group[0].contribution.ownerPluginId,
        dialectId: group[0].contribution.dialectId,
        ...(this.disabledSetVersion(group[0]) ? { version: this.disabledSetVersion(group[0]) } : {}),
        disabledAt,
        reason,
        artifacts
      });
    }
    return result;
  }

  private disabledSetVersion(candidate: ActiveArtifactCandidate): string | undefined {
    if (!candidate.version || candidate.kind === "nativeLibrary") return candidate.version;
    const companion = candidate.contribution.companionArtifacts?.find((artifact) => artifact.versionLockedToDriver);
    if (!companion) return candidate.version;
    try {
      return this.releaseVersion(companion, candidate.version);
    } catch {
      return candidate.version;
    }
  }

  private async recoverPendingDisabledSets(): Promise<boolean> {
    const pending = this.inventory.disabledSets.filter((disabledSet) => disabledSet.pendingDisable);
    for (const disabledSet of pending) {
      for (const artifact of disabledSet.artifacts) {
        if (!this.isActiveArtifactPath(artifact.originalFile, artifact.kind) || !this.isDisabledPath(artifact.disabledFile)) {
          throw new Error(`Pending disabled JDBC artifact '${disabledSet.id}' has invalid paths`);
        }
        await this.completeMove(artifact.originalFile, artifact.disabledFile, artifact.sha256);
      }
      disabledSet.pendingDisable = undefined;
    }
    return pending.length > 0;
  }

  private async completeMove(source: string, target: string, sha256: string): Promise<void> {
    const sourceExists = existsSync(source);
    const targetExists = existsSync(target);
    if (sourceExists && targetExists) throw new Error(`JDBC artifact move target '${basename(target)}' already exists`);
    if (!sourceExists && !targetExists) throw new Error(`JDBC artifact '${basename(source)}' is missing`);
    const existing = sourceExists ? source : target;
    if (await fileSha256(existing) !== sha256) throw new Error(`JDBC artifact '${basename(existing)}' failed integrity validation`);
    if (sourceExists) await this.moveArtifact(source, target);
  }

  private async applyDisabledSetRestore(disabledSet: DisabledSetEntry): Promise<void> {
    const contribution = TRUSTED_CONTRIBUTIONS.find((entry) => entry.ownerPluginId === disabledSet.ownerPluginId
      && entry.dialectId === disabledSet.dialectId);
    if (!contribution || !disabledSet.artifacts.some((artifact) => artifact.kind === "driver")) {
      throw new Error(`Disabled JDBC set '${disabledSet.id}' cannot be restored`);
    }
    for (const artifact of disabledSet.artifacts) {
      if (!this.isDisabledPath(artifact.disabledFile) || !this.isActiveArtifactPath(artifact.originalFile, artifact.kind)) {
        throw new Error(`Disabled JDBC artifact '${basename(artifact.disabledFile)}' has invalid paths`);
      }
    }
    let displacedSets = (disabledSet.restoreDisplacedSetIds ?? [])
      .map((id) => this.inventory.disabledSets.find((entry) => entry.id === id))
      .filter((entry): entry is DisabledSetEntry => Boolean(entry));
    if (!disabledSet.restoreDisplacedSetIds) {
      const current = await this.scanActiveArtifactCandidates([contribution]);
      displacedSets = await this.prepareDisabledSets(
        current,
        `Retained when JDBC artifact set ${disabledSet.version ?? disabledSet.id} was activated.`
      );
      for (const set of displacedSets) set.pendingDisable = true;
      disabledSet.restoreDisplacedSetIds = displacedSets.map((entry) => entry.id);
      this.inventory.disabledSets.push(...displacedSets);
      await this.writeInventory();
    } else if (displacedSets.length !== disabledSet.restoreDisplacedSetIds.length) {
      throw new Error(`Disabled JDBC restore '${disabledSet.id}' has an incomplete move journal`);
    }
    const displacedMoves: Array<{ original: string; disabled: string }> = [];
    const restoredMoves: Array<{ original: string; disabled: string }> = [];
    try {
      for (const set of displacedSets) {
        for (const artifact of set.artifacts) {
          await this.completeMove(artifact.originalFile, artifact.disabledFile, artifact.sha256);
          displacedMoves.push({ original: artifact.originalFile, disabled: artifact.disabledFile });
        }
        set.pendingDisable = undefined;
      }
      for (const artifact of disabledSet.artifacts) {
        await this.completeMove(artifact.disabledFile, artifact.originalFile, artifact.sha256);
        restoredMoves.push({ original: artifact.originalFile, disabled: artifact.disabledFile });
      }
    } catch (error) {
      try {
        for (const move of [...restoredMoves].reverse()) {
          if (existsSync(move.original) && !existsSync(move.disabled)) await this.moveArtifact(move.original, move.disabled);
        }
        for (const move of [...displacedMoves].reverse()) {
          if (existsSync(move.disabled) && !existsSync(move.original)) await this.moveArtifact(move.disabled, move.original);
        }
        this.inventory.disabledSets = this.inventory.disabledSets.filter((entry) => !displacedSets.includes(entry));
        disabledSet.restoreDisplacedSetIds = undefined;
        await this.writeInventory();
      } catch {
        // Keep the durable move journal so the next startup can finish the restore.
      }
      throw error;
    }
    const entry = this.getOrCreateEntry(contribution);
    entry.managedFile = undefined;
    entry.installedVersion = undefined;
    entry.installedSha256 = undefined;
    for (const companion of contribution.companionArtifacts ?? []) {
      const companionEntry = this.getOrCreateCompanionEntry(entry, companion.id);
      companionEntry.managedFile = undefined;
      companionEntry.installedVersion = undefined;
      companionEntry.installedSha256 = undefined;
    }
    for (const artifact of disabledSet.artifacts) {
      if (artifact.source !== "managed") continue;
      const targetEntry = artifact.kind === "driver" ? entry : this.getOrCreateCompanionEntry(entry, artifact.artifactId);
      targetEntry.managedFile = artifact.originalFile;
      targetEntry.installedVersion = artifact.version;
      targetEntry.installedSha256 = artifact.sha256;
    }
    this.inventory.disabledSets = this.inventory.disabledSets.filter((entry) => entry.id !== disabledSet.id);
  }

  private isActiveArtifactPath(path: string, kind: "driver" | "nativeLibrary"): boolean {
    return dirname(path) === (kind === "driver" ? this.libSharedDir : this.libNativeDir)
      && path.toLowerCase().endsWith(kind === "driver" ? ".jar" : ".dll");
  }

  private isDisabledPath(path: string): boolean {
    const parent = dirname(path);
    const roots = [join(this.libSharedDir, "disabled"), join(this.libNativeDir, "disabled")];
    return roots.some((root) => parent === root || parent.startsWith(`${root}${sep}`));
  }

  public async list(contributions: unknown): Promise<JdbcDriverStatus[]> {
    const validated = validateContributions(contributions).map(canonicalizeContribution);
    const manual = await this.scanManualDrivers(validated);
    const manualCompanions = await this.scanManualCompanions(validated);
    return validated.map((contribution) => {
      const key = driverKey(contribution);
      return this.buildStatus(contribution, manual.has(key), manual.get(key) ?? undefined, manualCompanions);
    });
  }

  public check(contributions: unknown): Promise<JdbcDriverStatus[]> {
    return this.enqueueMutation(() => this.checkInternal(contributions));
  }

  private async checkInternal(contributions: unknown): Promise<JdbcDriverStatus[]> {
    const validated = validateContributions(contributions).map(canonicalizeContribution);
    for (const contribution of validated) {
      if (!isTrusted(contribution)) continue;
      const entry = this.getOrCreateEntry(contribution);
      try {
        entry.latestVersion = await this.fetchLatestVersion(contribution);
        for (const companion of contribution.companionArtifacts ?? []) {
          const companionEntry = this.getOrCreateCompanionEntry(entry, companion.id);
          companionEntry.latestVersion = this.releaseVersion(companion, entry.latestVersion);
          companionEntry.error = undefined;
          companionEntry.lastCheckedAt = entry.lastCheckedAt;
        }
        entry.error = undefined;
      } catch (error) {
        entry.error = errorMessage(error);
      }
      entry.lastCheckedAt = this.now().toISOString();
      for (const companionEntry of entry.companions ?? []) companionEntry.lastCheckedAt = entry.lastCheckedAt;
    }
    await this.writeInventory();
    return this.list(validated);
  }

  public async install(contribution: unknown, artifactId?: unknown): Promise<JdbcDriverOperationResult> {
    return this.enqueueMutation(() => this.stageInstall(contribution, "install", validateArtifactId(artifactId)));
  }

  public update(contribution: unknown, artifactId?: unknown): Promise<JdbcDriverOperationResult> {
    return this.enqueueMutation(() => this.stageInstall(contribution, "update", validateArtifactId(artifactId)));
  }

  public remove(contributionValue: unknown, artifactId?: unknown): Promise<JdbcDriverOperationResult> {
    return this.enqueueMutation(() => this.removeInternal(contributionValue, validateArtifactId(artifactId)));
  }

  public restore(contributionValue: unknown, disabledSetIdValue: unknown): Promise<JdbcDriverOperationResult> {
    return this.enqueueMutation(async () => {
      const contribution = canonicalizeContribution(validateContribution(contributionValue));
      const disabledSetId = validateDisabledSetId(disabledSetIdValue);
      let status = (await this.list([contribution]))[0];
      if (!isTrusted(contribution)) return rejected(status, "Artifact restore is not available for this contribution");
      const disabledSet = this.inventory.disabledSets.find((entry) => entry.id === disabledSetId
        && entry.ownerPluginId === contribution.ownerPluginId && entry.dialectId === contribution.dialectId);
      if (!disabledSet) return rejected(status, "Disabled JDBC artifact set was not found");
      if (!disabledSet.artifacts.some((artifact) => artifact.kind === "driver")) {
        return rejected(status, "This disabled set has no JDBC JAR and cannot be restored safely");
      }
      for (const artifact of disabledSet.artifacts) {
        if (!this.isDisabledPath(artifact.disabledFile) || !this.isActiveArtifactPath(artifact.originalFile, artifact.kind)
          || !existsSync(artifact.disabledFile) || await fileSha256(artifact.disabledFile) !== artifact.sha256) {
          return rejected(status, `Disabled JDBC artifact '${basename(artifact.disabledFile)}' is missing or invalid`);
        }
      }
      if (this.inventory.disabledSets.some((entry) => entry.pendingRestore)) {
        return rejected(status, "Another JDBC artifact restore is already pending");
      }
      if (this.inventory.drivers.some((entry) => entry.pending || entry.companions?.some((companion) => companion.pending))) {
        return rejected(status, "Another JDBC artifact operation is already pending");
      }
      disabledSet.pendingRestore = true;
      await this.writeInventory();
      status = (await this.list([contribution]))[0];
      return { accepted: true, status };
    });
  }

  public discardRetainedSet(contributionValue: unknown, disabledSetIdValue: unknown): Promise<JdbcDriverOperationResult> {
    return this.enqueueMutation(async () => {
      const contribution = canonicalizeContribution(validateContribution(contributionValue));
      const disabledSetId = validateDisabledSetId(disabledSetIdValue);
      let status = (await this.list([contribution]))[0];
      if (!isTrusted(contribution)) return rejected(status, "Retained artifact removal is not available for this contribution");
      const disabledSet = this.inventory.disabledSets.find((entry) => entry.id === disabledSetId
        && entry.ownerPluginId === contribution.ownerPluginId && entry.dialectId === contribution.dialectId);
      if (!disabledSet) return rejected(status, "Retained JDBC artifact set was not found");
      if (disabledSet.pendingDisable || disabledSet.pendingRestore || disabledSet.restoreDisplacedSetIds) {
        return rejected(status, "This retained JDBC artifact set has a pending operation");
      }
      for (const artifact of disabledSet.artifacts) {
        if (!this.isDisabledPath(artifact.disabledFile) || !existsSync(artifact.disabledFile)
          || await fileSha256(artifact.disabledFile) !== artifact.sha256) {
          return rejected(status, `Retained JDBC artifact '${basename(artifact.disabledFile)}' is missing or invalid`);
        }
      }
      const fileNames = disabledSet.artifacts.map((artifact) => basename(artifact.disabledFile));
      for (const artifact of [...disabledSet.artifacts]) {
        try {
          await this.trashArtifact(artifact.disabledFile);
        } catch (error) {
          disabledSet.reason = `Recycle Bin removal was incomplete: ${errorMessage(error)}`;
          await this.writeInventory();
          status = (await this.list([contribution]))[0];
          return rejected(status, `Could not move all retained files to the Recycle Bin: ${errorMessage(error)}`);
        }
        disabledSet.artifacts = disabledSet.artifacts.filter((entry) => entry !== artifact);
        await this.writeInventory();
      }
      this.inventory.disabledSets = this.inventory.disabledSets.filter((entry) => entry !== disabledSet);
      await this.writeInventory();
      status = (await this.list([contribution]))[0];
      return { accepted: true, status, ...(fileNames.length === 0 ? { reason: "No retained files were present" } : {}) };
    });
  }

  private async removeInternal(contributionValue: unknown, artifactId?: string): Promise<JdbcDriverOperationResult> {
    const contribution = canonicalizeContribution(validateContribution(contributionValue));
    const status = (await this.list([contribution]))[0];
    if (!isTrusted(contribution)) return rejected(status, "Automatic management is not available for this contribution");
    if (this.inventory.disabledSets.some((entry) => entry.pendingRestore)) {
      return rejected(status, "A JDBC artifact restore is already pending");
    }
    const driverEntry = this.findEntry(contribution);
    const companion = this.findCompanion(contribution, artifactId);
    if (artifactId && !companion && artifactId !== contribution.artifactId) return rejected(status, "Unknown JDBC driver artifact");
    const lockedCompanions = this.lockedCompanions(contribution);
    if (lockedCompanions.length > 0 && (!companion || companion.versionLockedToDriver)) {
      return this.removeBundle(contribution, status, lockedCompanions);
    }
    const entry = companion && driverEntry ? this.findCompanionEntry(driverEntry, companion.id) : driverEntry;
    if (!entry?.managedFile && entry?.pending?.operation !== "install") {
      return rejected(status, "No managed driver is installed");
    }
    if (entry.pending?.stagedFile && this.isStagedPath(entry.pending.stagedFile)) {
      await rm(entry.pending.stagedFile, { force: true });
    }
    entry.pending = { operation: "remove" };
    await this.writeInventory();
    return { accepted: true, status: (await this.list([contribution]))[0] };
  }

  private async stageInstall(contributionValue: unknown, operation: "install" | "update", artifactId?: string): Promise<JdbcDriverOperationResult> {
    const contribution = canonicalizeContribution(validateContribution(contributionValue));
    let status = (await this.list([contribution]))[0];
    if (!isTrusted(contribution)) return rejected(status, "Automatic management is not available for this contribution");
    if (this.inventory.disabledSets.some((entry) => entry.pendingRestore)) {
      return rejected(status, "A JDBC artifact restore is already pending");
    }
    const driverEntry = this.getOrCreateEntry(contribution);
    const companion = this.findCompanion(contribution, artifactId);
    if (artifactId && !companion && artifactId !== contribution.artifactId) return rejected(status, "Unknown JDBC driver artifact");
    if (companion && !this.isApplicable(companion)) return rejected(status, "This artifact is not applicable to the current platform");
    const lockedCompanions = this.lockedCompanions(contribution);
    if (lockedCompanions.length > 0 && (!companion || companion.versionLockedToDriver)) {
      return this.stageBundleInstall(contribution, operation, status, driverEntry, lockedCompanions);
    }
    const entry = companion ? this.getOrCreateCompanionEntry(driverEntry, companion.id) : driverEntry;
    if (entry.pending) {
      return rejected(status, `A JDBC driver ${entry.pending.operation} is already pending`);
    }
    if (operation === "install" && entry.managedFile) {
      return rejected(status, "A managed driver is already installed");
    }
    if (operation === "update" && !entry.managedFile) {
      return rejected(status, "No managed driver is installed");
    }

    const token = `${companion?.id ?? contribution.artifactId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const extension = companion?.expectedFileExtension ?? ".jar";
    const stagedFile = join(this.stagingDir, `${token}${extension}`);
    try {
      const driverVersion = driverEntry.latestVersion ?? await this.fetchLatestVersion(contribution);
      driverEntry.latestVersion = driverVersion;
      const version = companion ? this.releaseVersion(companion, driverVersion) : driverVersion;
      if (operation === "update" && entry.installedVersion === version) {
        return rejected(status, "The managed driver is already at the latest compatible version");
      }
      const contents = companion
        ? await this.downloadCompanion(companion, version)
        : await this.downloadAndVerify(contribution, version);
      const sha256 = createHash("sha256").update(contents).digest("hex");
      const finalFile = companion
        ? join(this.libNativeDir, `mssql-jdbc_auth-${version}.${this.arch}.queryeer-managed.dll`)
        : join(this.libSharedDir, `${MANAGED_PREFIX}${contribution.artifactId}-${version}.jar`);
      if (existsSync(finalFile) && finalFile !== entry.managedFile) {
        throw new Error(`JDBC driver target '${basename(finalFile)}' already exists`);
      }
      await writeFile(stagedFile, contents, { flag: "wx" });
      entry.latestVersion = version;
      entry.lastCheckedAt = this.now().toISOString();
      entry.error = undefined;
      entry.pending = { operation, version, sha256, stagedFile, finalFile };
      await this.writeInventory();
      status = (await this.list([contribution]))[0];
      return { accepted: true, status };
    } catch (error) {
      await rm(stagedFile, { force: true });
      entry.pending = undefined;
      entry.error = errorMessage(error);
      entry.lastCheckedAt = this.now().toISOString();
      await this.writeInventory();
      status = (await this.list([contribution]))[0];
      return rejected(status, entry.error);
    }
  }

  private async stageBundleInstall(
    contribution: RegisteredJdbcManagedDriverContribution,
    operation: "install" | "update",
    initialStatus: JdbcDriverStatus,
    driverEntry: InventoryEntry,
    companions: JdbcDriverCompanionArtifact[]
  ): Promise<JdbcDriverOperationResult> {
    const members = [driverEntry, ...companions.map((companion) => this.getOrCreateCompanionEntry(driverEntry, companion.id))];
    if (members.some((entry) => entry.pending)) return rejected(initialStatus, "A JDBC driver package operation is already pending");
    const anyManaged = members.some((entry) => Boolean(entry.managedFile));
    if (operation === "update" && !anyManaged) return rejected(initialStatus, "No managed JDBC driver package is installed");

    const bundleId = `${contribution.dialectId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const stagedFiles: string[] = [];
    try {
      const driverVersion = await this.fetchLatestVersion(contribution);
      const versions = [driverVersion, ...companions.map((companion) => this.releaseVersion(companion, driverVersion))];
      if (operation === "update" && members.every((entry, index) => entry.managedFile && entry.installedVersion === versions[index])) {
        return rejected(initialStatus, "The managed JDBC driver package is already at the latest compatible version");
      }
      const contents = await Promise.all([
        this.downloadAndVerify(contribution, driverVersion),
        ...companions.map((companion, index) => this.downloadCompanion(companion, versions[index + 1]))
      ]);
      const finalFiles = [
        join(this.libSharedDir, `${MANAGED_PREFIX}${contribution.artifactId}-${driverVersion}.jar`),
        ...companions.map((_companion, index) => join(
          this.libNativeDir,
          `mssql-jdbc_auth-${versions[index + 1]}.${this.arch}.queryeer-managed.dll`
        ))
      ];
      for (let index = 0; index < finalFiles.length; index += 1) {
        if (existsSync(finalFiles[index]) && finalFiles[index] !== members[index].managedFile
          && await fileSha256(finalFiles[index]) !== createHash("sha256").update(contents[index]).digest("hex")) {
          throw new Error(`JDBC package target '${basename(finalFiles[index])}' already exists`);
        }
      }
      for (let index = 0; index < contents.length; index += 1) {
        const extension = index === 0 ? ".jar" : companions[index - 1].expectedFileExtension;
        const stagedFile = join(this.stagingDir, `${bundleId}-${index}${extension}`);
        await writeFile(stagedFile, contents[index], { flag: "wx" });
        stagedFiles.push(stagedFile);
      }
      const checkedAt = this.now().toISOString();
      for (let index = 0; index < members.length; index += 1) {
        members[index].latestVersion = versions[index];
        members[index].lastCheckedAt = checkedAt;
        members[index].error = undefined;
        members[index].pending = {
          operation,
          bundleId,
          bundleSize: members.length,
          version: versions[index],
          sha256: createHash("sha256").update(contents[index]).digest("hex"),
          stagedFile: stagedFiles[index],
          finalFile: finalFiles[index]
        };
      }
      await this.writeInventory();
      return { accepted: true, status: (await this.list([contribution]))[0] };
    } catch (error) {
      await Promise.all(stagedFiles.map((file) => rm(file, { force: true })));
      for (const member of members) member.pending = undefined;
      const message = errorMessage(error);
      for (const member of members) member.error = message;
      await this.writeInventory();
      return rejected((await this.list([contribution]))[0], message);
    }
  }

  private async removeBundle(
    contribution: RegisteredJdbcManagedDriverContribution,
    status: JdbcDriverStatus,
    companions: JdbcDriverCompanionArtifact[]
  ): Promise<JdbcDriverOperationResult> {
    const driverEntry = this.findEntry(contribution);
    if (!driverEntry) return rejected(status, "No managed JDBC driver package is installed");
    const members = [driverEntry, ...companions.map((companion) => this.getOrCreateCompanionEntry(driverEntry, companion.id))];
    if (!members.some((entry) => entry.managedFile || entry.pending?.operation === "install")) {
      return rejected(status, "No managed JDBC driver package is installed");
    }
    for (const member of members) {
      if (member.pending?.stagedFile && this.isStagedPath(member.pending.stagedFile)) {
        await rm(member.pending.stagedFile, { force: true });
      }
    }
    const bundleId = `${contribution.dialectId}-remove-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    for (const member of members) member.pending = { operation: "remove", bundleId, bundleSize: members.length };
    await this.writeInventory();
    return { accepted: true, status: (await this.list([contribution]))[0] };
  }

  private async fetchLatestVersion(contribution: RegisteredJdbcManagedDriverContribution): Promise<string> {
    const path = `${contribution.groupId.replaceAll(".", "/")}/${contribution.artifactId}/maven-metadata.xml`;
    const response = await this.fetchFixed(`${MAVEN_ROOT}/${path}`);
    if (!response.ok) throw new Error(`Maven metadata request failed with HTTP ${response.status}`);
    const xml = await response.text();
    const versions = [...xml.matchAll(/<version>\s*([^<]+?)\s*<\/version>/g)].map((match) => match[1].trim());
    const compatible = contribution.compatibleVersionRegex
      ? new RegExp(contribution.compatibleVersionRegex)
      : undefined;
    const selected = versions
      .filter((version) => /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(version)
        && !/snapshot/i.test(version)
        && !/(?:^|[.-])(?:alpha|beta|rc|cr|milestone|preview|ea|m)\d*(?:[.-]|$)/i.test(version)
        && (!compatible || compatible.test(version)))
      .sort(compareVersions)
      .at(-1);
    if (!selected) throw new Error("Maven metadata contains no compatible release version");
    return selected;
  }

  private async downloadAndVerify(contribution: RegisteredJdbcManagedDriverContribution, version: string): Promise<Buffer> {
    const base = `${MAVEN_ROOT}/${contribution.groupId.replaceAll(".", "/")}/${contribution.artifactId}/${version}`;
    const jarUrl = `${base}/${contribution.artifactId}-${version}.jar`;
    const [jarResponse, sha256Response] = await Promise.all([
      this.fetchFixed(jarUrl),
      this.fetchFixed(`${jarUrl}.sha256`)
    ]);
    if (!jarResponse.ok) throw new Error(`JDBC driver download failed with HTTP ${jarResponse.status}`);
    const checksumResponse = sha256Response.ok
      ? sha256Response
      : await this.fetchFixed(`${jarUrl}.sha1`);
    if (!checksumResponse.ok) throw new Error(`JDBC driver checksum request failed with HTTP ${checksumResponse.status}`);
    const contentLength = Number(jarResponse.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
      throw new Error("JDBC driver exceeds the 100 MiB download limit");
    }
    const jar = Buffer.from(await jarResponse.arrayBuffer());
    if (jar.length > MAX_DOWNLOAD_BYTES) throw new Error("JDBC driver exceeds the 100 MiB download limit");
    const checksumText = (await checksumResponse.text()).trim();
    const checksumLength = sha256Response.ok ? 64 : 40;
    const expected = checksumText.match(new RegExp(`^[a-fA-F0-9]{${checksumLength}}`))?.[0]?.toLowerCase();
    if (!expected) throw new Error("Maven checksum response is invalid");
    const actual = createHash(sha256Response.ok ? "sha256" : "sha1").update(jar).digest("hex");
    if (actual !== expected) throw new Error("JDBC driver checksum mismatch");
    await assertJarContainsDriver(jar, contribution.driverClassName);
    return jar;
  }

  private async downloadCompanion(companion: JdbcDriverCompanionArtifact, releaseVersion: string): Promise<Buffer> {
    const tag = companion.source.releaseTagTemplate.replace("{releaseVersion}", releaseVersion);
    const metadataUrl = `${GITHUB_API_ORIGIN}/repos/${companion.source.repository}/releases/tags/${encodeURIComponent(tag)}`;
    const metadataResponse = await this.fetchGitHub(metadataUrl, false);
    if (!metadataResponse.ok) throw new Error(`GitHub release metadata request failed with HTTP ${metadataResponse.status}`);
    const metadata = await metadataResponse.json() as { assets?: Array<{ name?: unknown; browser_download_url?: unknown; digest?: unknown }> };
    const asset = metadata.assets?.find((candidate) => candidate.name === companion.source.assetName);
    if (!asset || typeof asset.browser_download_url !== "string") throw new Error(`GitHub release asset '${companion.source.assetName}' is missing`);
    const expectedDigest = typeof asset.digest === "string" ? asset.digest.match(/^sha256:([a-fA-F0-9]{64})$/)?.[1].toLowerCase() : undefined;
    if (!expectedDigest) throw new Error("GitHub release asset SHA-256 digest is missing or invalid");
    const archiveResponse = await this.fetchGitHub(asset.browser_download_url, true);
    if (!archiveResponse.ok) throw new Error(`Native library download failed with HTTP ${archiveResponse.status}`);
    const contentLength = Number(archiveResponse.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) throw new Error("Native library archive exceeds the 100 MiB download limit");
    const archiveBuffer = Buffer.from(await archiveResponse.arrayBuffer());
    if (archiveBuffer.length > MAX_DOWNLOAD_BYTES) throw new Error("Native library archive exceeds the 100 MiB download limit");
    const actualDigest = createHash("sha256").update(archiveBuffer).digest("hex");
    if (actualDigest !== expectedDigest) throw new Error("Native library archive checksum mismatch");
    let archive: JSZip;
    try {
      archive = await JSZip.loadAsync(archiveBuffer);
    } catch {
      throw new Error("Native library download is not a valid ZIP archive");
    }
    const entryName = companion.source.archiveEntryTemplate
      .replaceAll("{releaseVersion}", releaseVersion)
      .replaceAll("{arch}", this.arch);
    const entry = archive.file(entryName);
    if (!entry) throw new Error(`Native library archive entry '${entryName}' is missing`);
    const dll = await entry.async("nodebuffer");
    if (dll.length < 2 || dll[0] !== 0x4d || dll[1] !== 0x5a) throw new Error("Native library does not have a valid MZ header");
    return dll;
  }

  private async fetchGitHub(urlValue: string, allowDownloadRedirects: boolean): Promise<Response> {
    let url = new URL(urlValue);
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const trustedApi = url.origin === GITHUB_API_ORIGIN;
      if (url.protocol !== "https:" || (!trustedApi && (!allowDownloadRedirects || !GITHUB_DOWNLOAD_HOSTS.has(url.hostname)))) {
        throw new Error("Untrusted native library download URL");
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          signal: controller.signal,
          redirect: "manual",
          headers: trustedApi ? { accept: "application/vnd.github+json" } : undefined
        });
      } finally {
        clearTimeout(timeout);
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      if (!allowDownloadRedirects) throw new Error("Unexpected GitHub API redirect");
      const location = response.headers.get("location");
      if (!location) throw new Error("Native library download redirect is missing a location");
      url = new URL(location, url);
    }
    throw new Error("Native library download has too many redirects");
  }

  private async fetchFixed(urlValue: string): Promise<Response> {
    const url = new URL(urlValue);
    if (url.protocol !== "https:" || url.origin !== MAVEN_ORIGIN) throw new Error("Untrusted JDBC driver download URL");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url.toString(), { signal: controller.signal, redirect: "error" });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async scanManualDrivers(contributions: RegisteredJdbcManagedDriverContribution[]): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    let names: string[];
    try {
      names = await readdir(this.libSharedDir);
    } catch {
      return result;
    }
    const jars = names.filter((name) => name.toLowerCase().endsWith(".jar") && !name.startsWith(MANAGED_PREFIX));
    for (const name of jars) {
      try {
        const archive = await JSZip.loadAsync(await readFile(join(this.libSharedDir, name)));
        for (const contribution of contributions) {
          const key = driverKey(contribution);
          if (result.has(key) || !archive.file(classEntry(contribution.driverClassName))) continue;
          result.set(key, (await readJarVersion(archive, name, contribution.artifactId)) ?? null);
        }
      } catch {
        // Ignore unrelated or corrupt jars in the shared directory.
      }
    }
    return result;
  }

  private async scanManualCompanions(contributions: RegisteredJdbcManagedDriverContribution[]): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    let names: string[];
    try {
      names = await readdir(this.libNativeDir);
    } catch {
      return result;
    }
    for (const contribution of contributions) {
      for (const companion of contribution.companionArtifacts ?? []) {
        if (!this.isApplicable(companion)) continue;
        const name = names.find((candidate) => candidate.toLowerCase().endsWith(companion.expectedFileExtension)
          && /^(?:mssql-jdbc_auth.*|sqljdbc_auth)\.dll$/i.test(candidate)
          && !candidate.includes(".queryeer-managed."));
        if (!name) continue;
        const version = name.match(/^mssql-jdbc_auth-([0-9]+\.[0-9]+\.[0-9]+)(?:\.[^.]+)?\.dll$/i)?.[1];
        result.set(artifactKey(contribution, companion.id), version ?? null);
      }
    }
    return result;
  }

  private buildStatus(
    contribution: RegisteredJdbcManagedDriverContribution,
    manualDetected: boolean,
    manualVersion: string | undefined,
    manualCompanions: Map<string, string | null>
  ): JdbcDriverStatus {
    const entry = this.findEntry(contribution);
    const disabledSets: JdbcDriverDisabledSetStatus[] = this.inventory.disabledSets
      .filter((disabledSet) => disabledSet.ownerPluginId === contribution.ownerPluginId
        && disabledSet.dialectId === contribution.dialectId)
      .map((disabledSet) => ({
        id: disabledSet.id,
        ...(disabledSet.version ? { version: disabledSet.version } : {}),
        disabledAt: disabledSet.disabledAt,
        reason: disabledSet.reason,
        pendingRestore: Boolean(disabledSet.pendingRestore),
        restorable: disabledSet.artifacts.some((artifact) => artifact.kind === "driver")
          && disabledSet.artifacts.every((artifact) => existsSync(artifact.disabledFile)),
        artifacts: disabledSet.artifacts.map((artifact) => ({
          artifactId: artifact.artifactId,
          fileName: basename(artifact.originalFile),
          source: artifact.source,
          ...(artifact.version ? { version: artifact.version } : {})
        }))
      }));
    const managedFileExists = Boolean(entry?.managedFile && existsSync(entry.managedFile));
    const managed = managedFileExists || entry?.pending?.operation === "install";
    const installedVersion = entry?.pending?.operation === "install"
      ? entry.pending.version
      : managedFileExists ? entry?.installedVersion : manualVersion;
    const latestVersion = entry?.latestVersion;
    const primary: JdbcDriverArtifactStatus = {
      id: contribution.artifactId,
      displayName: "JDBC JAR",
      kind: "driver",
      applicable: true,
      source: managed ? "managed" : manualDetected ? "manual" : "missing",
      ...(installedVersion ? { installedVersion } : {}),
      ...(latestVersion ? { latestVersion } : {}),
      updateAvailable: Boolean(installedVersion && latestVersion && compareVersions(installedVersion, latestVersion) < 0),
      restartRequired: Boolean(entry?.pending),
      managementAvailable: isTrusted(contribution),
      ...(entry?.pending ? { pendingOperation: entry.pending.operation } : {}),
      ...(entry?.error ? { error: entry.error } : {})
    };
    const companions = (contribution.companionArtifacts ?? []).map((companion): JdbcDriverArtifactStatus => {
      const companionEntry = entry ? this.findCompanionEntry(entry, companion.id) : undefined;
      const applicable = this.isApplicable(companion);
      const managedFileExists = Boolean(companionEntry?.managedFile && existsSync(companionEntry.managedFile));
      const managed = managedFileExists || companionEntry?.pending?.operation === "install";
      const manualKey = artifactKey(contribution, companion.id);
      const manualDetected = manualCompanions.has(manualKey);
      const installedVersion = companionEntry?.pending?.operation === "install"
        ? companionEntry.pending.version
        : managedFileExists ? companionEntry?.installedVersion : manualCompanions.get(manualKey) ?? undefined;
      const latestVersion = companionEntry?.latestVersion;
      return {
        id: companion.id,
        displayName: companion.displayName,
        kind: companion.kind,
        applicable,
        source: managed ? "managed" : manualDetected ? "manual" : "missing",
        ...(installedVersion ? { installedVersion } : {}),
        ...(latestVersion ? { latestVersion } : {}),
        updateAvailable: Boolean(installedVersion && latestVersion && compareVersions(installedVersion, latestVersion) < 0),
        restartRequired: Boolean(companionEntry?.pending),
        managementAvailable: applicable && isTrusted(contribution),
        ...(companionEntry?.pending ? { pendingOperation: companionEntry.pending.operation } : {}),
        ...(companionEntry?.error ? { error: companionEntry.error } : {})
      };
    });
    let packageVersionMismatch = false;
    let packageWarning: string | undefined;
    for (let index = 0; index < companions.length; index += 1) {
      const declaration = contribution.companionArtifacts![index];
      const companionStatus = companions[index];
      if (!declaration.versionLockedToDriver || !companionStatus.applicable) continue;
      primary.managedWithPrimary = true;
      companionStatus.managedWithPrimary = true;
      let mismatch = false;
      if (primary.installedVersion) {
        try {
          mismatch = !companionStatus.installedVersion
            || companionStatus.installedVersion !== this.releaseVersion(declaration, primary.installedVersion);
        } catch {
          mismatch = true;
        }
      } else if (companionStatus.installedVersion) {
        mismatch = true;
      }
      if ((primary.source === "managed") !== (companionStatus.source === "managed")) mismatch = true;
      if (mismatch) {
        primary.versionMismatch = true;
        companionStatus.versionMismatch = true;
        primary.updateAvailable = true;
        companionStatus.updateAvailable = true;
        packageVersionMismatch = true;
      }
      const manualDetected = manualCompanions.has(artifactKey(contribution, declaration.id));
      if (manualDetected && companionStatus.source === "managed") {
        packageWarning = "A manual SQL Server authentication DLL is also present. Remove it to eliminate ambiguity.";
        companionStatus.warning = packageWarning;
      }
    }
    return {
      contribution,
      source: primary.source,
      ...(installedVersion ? { installedVersion } : {}),
      ...(latestVersion ? { latestVersion } : {}),
      updateAvailable: primary.updateAvailable,
      restartRequired: primary.restartRequired || disabledSets.some((disabledSet) => disabledSet.pendingRestore),
      managementAvailable: isTrusted(contribution),
      ...(packageVersionMismatch ? { versionMismatch: true } : {}),
      ...(packageWarning ? { warning: packageWarning } : {}),
      artifacts: [primary, ...companions],
      ...(disabledSets.length > 0 ? { disabledSets } : {}),
      ...(entry?.pending ? { pendingOperation: entry.pending.operation } : {}),
      ...(entry?.lastCheckedAt ? { lastCheckedAt: entry.lastCheckedAt } : {}),
      ...(entry?.error ? { error: entry.error } : {})
    };
  }

  private findEntry(contribution: RegisteredJdbcManagedDriverContribution): InventoryEntry | undefined {
    return this.inventory.drivers.find((entry) => entry.ownerPluginId === contribution.ownerPluginId
      && entry.dialectId === contribution.dialectId);
  }

  private getOrCreateEntry(contribution: RegisteredJdbcManagedDriverContribution): InventoryEntry {
    let entry = this.findEntry(contribution);
    if (!entry) {
      entry = { ownerPluginId: contribution.ownerPluginId, dialectId: contribution.dialectId };
      this.inventory.drivers.push(entry);
    }
    return entry;
  }

  private findCompanion(contribution: RegisteredJdbcManagedDriverContribution, artifactId?: string): JdbcDriverCompanionArtifact | undefined {
    return artifactId ? contribution.companionArtifacts?.find((artifact) => artifact.id === artifactId) : undefined;
  }

  private findCompanionEntry(entry: InventoryEntry, id: string): CompanionInventoryEntry | undefined {
    return entry.companions?.find((companion) => companion.id === id);
  }

  private getOrCreateCompanionEntry(entry: InventoryEntry, id: string): CompanionInventoryEntry {
    entry.companions ??= [];
    let companion = this.findCompanionEntry(entry, id);
    if (!companion) {
      companion = { id };
      entry.companions.push(companion);
    }
    return companion;
  }

  private lockedCompanions(contribution: RegisteredJdbcManagedDriverContribution): JdbcDriverCompanionArtifact[] {
    return (contribution.companionArtifacts ?? [])
      .filter((companion) => companion.versionLockedToDriver === true && this.isApplicable(companion));
  }

  private isApplicable(companion: JdbcDriverCompanionArtifact): boolean {
    const os = this.platform === "win32" ? "windows" : this.platform === "darwin" ? "macos" : "linux";
    return companion.platforms.some((platform) => platform.os === os && platform.arch === this.arch);
  }

  private releaseVersion(companion: JdbcDriverCompanionArtifact, driverVersion: string): string {
    const expression = new RegExp(companion.source.driverVersionToReleaseVersion.pattern);
    if (!expression.test(driverVersion)) throw new Error(`Driver version '${driverVersion}' cannot be mapped to a native release`);
    return driverVersion.replace(expression, companion.source.driverVersionToReleaseVersion.replacement);
  }

  private async readInventory(): Promise<InventoryDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.inventoryPath, "utf8")) as InventoryDocument | { version: 1; drivers: InventoryEntry[] };
      if (parsed.version === INVENTORY_VERSION && Array.isArray(parsed.drivers) && Array.isArray(parsed.disabledSets)) return parsed;
      if (parsed.version === 1 && Array.isArray(parsed.drivers)) {
        return { version: INVENTORY_VERSION, drivers: parsed.drivers, disabledSets: [] };
      }
    } catch {
      // Missing or invalid inventory starts empty.
    }
    return { version: INVENTORY_VERSION, drivers: [], disabledSets: [] };
  }

  private async writeInventory(): Promise<void> {
    const temporary = `${this.inventoryPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(this.inventory, null, 2)}\n`, { flag: "wx" });
      await rename(temporary, this.inventoryPath);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private isManagedPath(path: string): boolean {
    return (dirname(path) === this.libSharedDir && basename(path).startsWith(MANAGED_PREFIX))
      || (dirname(path) === this.libNativeDir && basename(path).includes(".queryeer-managed."));
  }

  private isStagedPath(path: string): boolean {
    return dirname(path) === this.stagingDir && [".jar", ".dll"].some((extension) => basename(path).endsWith(extension));
  }

  private enqueueMutation<T>(action: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(action, action);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

function validateContributions(value: unknown): RegisteredJdbcManagedDriverContribution[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("JDBC driver contributions must be an array");
  return value.map(validateContribution);
}

function validateContribution(value: unknown): RegisteredJdbcManagedDriverContribution {
  if (!value || typeof value !== "object") throw new Error("Invalid JDBC driver contribution");
  const input = value as Record<string, unknown>;
  const required = ["ownerPluginId", "dialectId", "displayName", "groupId", "artifactId", "driverClassName"] as const;
  for (const field of required) {
    if (typeof input[field] !== "string" || input[field].length === 0 || input[field].length > 200) {
      throw new Error(`Invalid JDBC driver contribution field '${field}'`);
    }
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(input.ownerPluginId as string)
    || !/^[A-Za-z0-9_.-]+$/.test(input.dialectId as string)
    || !/^[A-Za-z0-9_.-]+$/.test(input.groupId as string)
    || !/^[A-Za-z0-9_.-]+$/.test(input.artifactId as string)
    || !/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(input.driverClassName as string)) {
    throw new Error("JDBC driver contribution contains invalid identifiers");
  }
  if (input.compatibleVersionRegex !== undefined) {
    if (typeof input.compatibleVersionRegex !== "string" || input.compatibleVersionRegex.length > 200) {
      throw new Error("Invalid JDBC compatible version expression");
    }
    try { new RegExp(input.compatibleVersionRegex); } catch { throw new Error("Invalid JDBC compatible version expression"); }
  }
  if (input.downloadPageUrl !== undefined) {
    if (typeof input.downloadPageUrl !== "string" || input.downloadPageUrl.length > 2_000) {
      throw new Error("Invalid JDBC driver download page URL");
    }
    const url = new URL(input.downloadPageUrl);
    if (url.protocol !== "https:") throw new Error("JDBC driver download page must use HTTPS");
  }
  const companionArtifacts = input.companionArtifacts === undefined
    ? undefined
    : validateCompanions(input.companionArtifacts);
  return {
    ownerPluginId: input.ownerPluginId as string,
    dialectId: input.dialectId as string,
    displayName: input.displayName as string,
    groupId: input.groupId as string,
    artifactId: input.artifactId as string,
    driverClassName: input.driverClassName as string,
    ...(input.compatibleVersionRegex ? { compatibleVersionRegex: input.compatibleVersionRegex as string } : {}),
    ...(input.downloadPageUrl ? { downloadPageUrl: input.downloadPageUrl as string } : {}),
    ...(companionArtifacts ? { companionArtifacts } : {})
  };
}

function validateCompanions(value: unknown): JdbcDriverCompanionArtifact[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error("Invalid JDBC companion artifacts");
  const ids = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid JDBC companion artifact");
    const input = item as Record<string, unknown>;
    if (typeof input.id !== "string" || !/^[A-Za-z0-9_.-]+$/.test(input.id) || ids.has(input.id)
      || typeof input.displayName !== "string" || input.displayName.length === 0 || input.displayName.length > 200
      || input.kind !== "nativeLibrary" || input.targetDirectory !== "libNative" || input.expectedFileExtension !== ".dll") {
      throw new Error("Invalid JDBC companion artifact fields");
    }
    ids.add(input.id);
    if (!Array.isArray(input.platforms) || input.platforms.length === 0 || input.platforms.some((platform) => {
      if (!platform || typeof platform !== "object") return true;
      const candidate = platform as Record<string, unknown>;
      return !["windows", "linux", "macos"].includes(String(candidate.os))
        || !["x64", "x86", "arm64"].includes(String(candidate.arch));
    })) throw new Error("Invalid JDBC companion platforms");
    if (!input.source || typeof input.source !== "object") throw new Error("Invalid JDBC companion source");
    const source = input.source as Record<string, unknown>;
    const mapping = source.driverVersionToReleaseVersion as Record<string, unknown> | undefined;
    for (const field of ["repository", "releaseTagTemplate", "assetName", "archiveEntryTemplate"] as const) {
      if (typeof source[field] !== "string" || source[field].length === 0 || source[field].length > 500) {
        throw new Error("Invalid JDBC companion source fields");
      }
    }
    if (source.type !== "githubReleaseArchive" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repository as string)
      || !mapping || typeof mapping.pattern !== "string" || typeof mapping.replacement !== "string") {
      throw new Error("Invalid JDBC companion source fields");
    }
    if (input.versionLockedToDriver !== undefined && typeof input.versionLockedToDriver !== "boolean") {
      throw new Error("Invalid JDBC companion version lock");
    }
    try { new RegExp(mapping.pattern); } catch { throw new Error("Invalid JDBC companion version mapping"); }
    return item as JdbcDriverCompanionArtifact;
  });
}

function isTrusted(contribution: RegisteredJdbcManagedDriverContribution): boolean {
  return TRUSTED_CONTRIBUTIONS.includes(contribution);
}

function canonicalizeContribution(
  contribution: RegisteredJdbcManagedDriverContribution
): RegisteredJdbcManagedDriverContribution {
  const trusted = TRUSTED_CONTRIBUTIONS.find((candidate) =>
    candidate.ownerPluginId === contribution.ownerPluginId
    && candidate.dialectId === contribution.dialectId);
  if (!trusted) return contribution;
  const identityMatches = trusted.groupId === contribution.groupId
    && trusted.artifactId === contribution.artifactId
    && trusted.driverClassName === contribution.driverClassName;
  return identityMatches ? trusted : contribution;
}

function driverKey(contribution: RegisteredJdbcManagedDriverContribution): string {
  return `${contribution.ownerPluginId}\0${contribution.dialectId}`;
}

function artifactKey(contribution: RegisteredJdbcManagedDriverContribution, artifactId: string): string {
  return `${driverKey(contribution)}\0${artifactId}`;
}

function validateArtifactId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error("Invalid JDBC driver artifact ID");
  return value;
}

function validateDisabledSetId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 300 || !/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error("Invalid disabled JDBC artifact set ID");
  }
  return value;
}

function normalizeArch(value: string): "x64" | "x86" | "arm64" {
  if (value === "ia32" || value === "x86") return "x86";
  if (value === "arm64" || value === "aarch64") return "arm64";
  return "x64";
}

function classEntry(className: string): string {
  return `${className.replaceAll(".", "/")}.class`;
}

async function assertJarContainsDriver(jar: Buffer, driverClassName: string): Promise<void> {
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(jar);
  } catch {
    throw new Error("Downloaded JDBC driver is not a valid JAR");
  }
  if (!archive.file(classEntry(driverClassName))) {
    throw new Error(`Downloaded JAR does not contain driver class '${driverClassName}'`);
  }
}

async function readJarVersion(archive: JSZip, fileName: string, artifactId: string): Promise<string | undefined> {
  const manifest = archive.file(/(^|\/)META-INF\/MANIFEST\.MF$/i)[0];
  if (manifest) {
    const text = (await manifest.async("string")).replace(/\r?\n /g, "");
    const version = text.match(/^Implementation-Version:\s*(.+?)\s*$/im)?.[1];
    if (version) return version;
  }
  const escaped = artifactId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return fileName.match(new RegExp(`^${escaped}-([0-9][A-Za-z0-9._+-]*)\\.jar$`, "i"))?.[1];
}

export function compareVersions(left: string, right: string): number {
  const leftParts = left.match(/\d+|[^\d]+/g) ?? [];
  const rightParts = right.match(/\d+|[^\d]+/g) ?? [];
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const a = leftParts[index];
    const b = rightParts[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    const numericA = /^\d+$/.test(a);
    const numericB = /^\d+$/.test(b);
    if (numericA && numericB) {
      const normalizedA = a.replace(/^0+(?=\d)/, "");
      const normalizedB = b.replace(/^0+(?=\d)/, "");
      if (normalizedA.length !== normalizedB.length) return normalizedA.length - normalizedB.length;
      return normalizedA.localeCompare(normalizedB);
    }
    return a.localeCompare(b, "en", { sensitivity: "base" });
  }
  return 0;
}

function rejected(status: JdbcDriverStatus, reason: string): JdbcDriverOperationResult {
  return { accepted: false, reason, status };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "JDBC driver operation failed";
}

async function fileSha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

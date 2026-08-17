import type { NotificationService } from "@queryeer/api/extensions/NotificationExtension";
import type {
  JdbcDriverArtifactStatus,
  JdbcDriverDisabledSetStatus,
  JdbcDriverOperationResult,
  JdbcDriverStatus,
  RegisteredJdbcManagedDriverContribution
} from "@queryeer/api/queryengine/JdbcDriverExtension";
import type { ShellApi } from "@queryeer/api/shell/Api";
import { parseJdbcConnectionDefinitions } from "./jdbc-settings";

export const JDBC_DRIVER_UPDATE_CHECK_SETTING_ID = "core.queryengine.jdbc.driverUpdateCheck.enabled";
export const JDBC_DRIVERS_SETTING_ID = "core.queryengine.jdbc.drivers";
export const JDBC_DRIVER_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const LAST_CHECK_STORAGE_KEY = "queryeer.jdbcDrivers.lastCheck";
const UPDATE_NOTICE_SUPPRESSION_STORAGE_PREFIX = "queryeer.jdbcDrivers.suppressedUpdate.v2.";
const SQLITE_MIGRATION_NOTICE_STORAGE_KEY = "queryeer.jdbcDrivers.sqliteMigrationNotice.v1";

type DriverShell = Pick<ShellApi,
  | "listJdbcDrivers"
  | "checkJdbcDrivers"
  | "installJdbcDriver"
  | "updateJdbcDriver"
  | "removeJdbcDriver"
  | "restoreJdbcDriver"
  | "discardJdbcDriverRetainedSet"
  | "restartBackendForJdbcDrivers"
>;

export type JdbcDriverManagementOptions = {
  contributions: readonly RegisteredJdbcManagedDriverContribution[];
  shell: DriverShell;
  notifications: NotificationService;
  openSettings: () => void | Promise<void>;
  confirmOperation: (
    operation: "install" | "update" | "remove" | "activate" | "discard",
    contribution: RegisteredJdbcManagedDriverContribution,
    artifact: JdbcDriverArtifactStatus
  ) => Promise<boolean>;
  updateChecksEnabled: () => boolean;
  persistedConnections: () => unknown;
  now?: () => number;
  storage?: Storage;
  windowTarget?: Pick<Window, "addEventListener" | "removeEventListener">;
  documentTarget?: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
};

export class JdbcDriverManagementService {
  private options: JdbcDriverManagementOptions | null = null;
  private statuses: readonly JdbcDriverStatus[] = [];
  private readonly subscribers = new Set<() => void>();
  private checkPromise: Promise<readonly JdbcDriverStatus[]> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly notifiedUpdatesThisSession = new Set<string>();

  private readonly handleOnline = (): void => {
    void this.checkIfStale();
  };

  private readonly handleVisibilityChange = (): void => {
    if (this.options?.documentTarget?.visibilityState === "visible") {
      void this.checkIfStale();
    }
  };

  public async initialize(options: JdbcDriverManagementOptions): Promise<void> {
    this.reset();
    this.options = options;
    options.windowTarget?.addEventListener("online", this.handleOnline);
    options.documentTarget?.addEventListener("visibilitychange", this.handleVisibilityChange);
    await this.refresh();
    this.notifySqliteMigrationIfNeeded();
    if (options.updateChecksEnabled()) {
      void this.checkNow().finally(() => this.scheduleNextCheck());
    }
  }

  public subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  public getStatuses(): readonly JdbcDriverStatus[] {
    return this.statuses;
  }

  public async refresh(): Promise<readonly JdbcDriverStatus[]> {
    const options = this.requireOptions();
    return this.setStatuses(await options.shell.listJdbcDrivers([...options.contributions]));
  }

  public checkNow(notifyKnownUpdates = false): Promise<readonly JdbcDriverStatus[]> {
    if (this.checkPromise) {
      return this.checkPromise;
    }
    const options = this.requireOptions();
    this.checkPromise = (async () => {
      try {
        const statuses = this.setStatuses(await options.shell.checkJdbcDrivers([...options.contributions]));
        options.storage?.setItem(LAST_CHECK_STORAGE_KEY, String(this.now()));
        this.notifyAvailableUpdates(statuses, notifyKnownUpdates);
        return statuses;
      } finally {
        this.checkPromise = null;
      }
    })();
    return this.checkPromise;
  }

  public updateCheckPreferenceChanged(): void {
    const options = this.requireOptions();
    if (!options.updateChecksEnabled()) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      return;
    }
    void this.checkIfStale().finally(() => this.scheduleNextCheck());
  }

  public install(dialectId: string, artifactId?: string): Promise<JdbcDriverOperationResult> {
    return this.runOperation(dialectId, "installJdbcDriver", "installed", artifactId);
  }

  public update(dialectId: string, artifactId?: string): Promise<JdbcDriverOperationResult> {
    return this.runOperation(dialectId, "updateJdbcDriver", "updated", artifactId);
  }

  public remove(dialectId: string, artifactId?: string): Promise<JdbcDriverOperationResult> {
    return this.runOperation(dialectId, "removeJdbcDriver", "removed", artifactId);
  }

  public async restore(dialectId: string, disabledSetId: string): Promise<JdbcDriverOperationResult> {
    const options = this.requireOptions();
    const contribution = options.contributions.find((entry) => entry.dialectId === dialectId);
    if (!contribution) throw new Error(`Unknown JDBC driver '${dialectId}'`);
    const currentStatus = this.statuses.find((entry) => entry.contribution.dialectId === dialectId)
      ?? (await this.refresh()).find((entry) => entry.contribution.dialectId === dialectId);
    const disabledSet = currentStatus?.disabledSets?.find((entry) => entry.id === disabledSetId);
    if (!currentStatus || !disabledSet) throw new Error(`Disabled JDBC artifact set '${disabledSetId}' is unavailable`);
    const artifact = restoreArtifact(disabledSet, contribution.artifactId);
    if (!await options.confirmOperation("activate", contribution, artifact)) {
      return { accepted: false, reason: "JDBC driver operation cancelled", status: currentStatus };
    }
    const result = await options.shell.restoreJdbcDriver(contribution, disabledSetId);
    if (result.accepted) {
      await this.refresh();
      const restartNotification = options.notifications.notify({
        title: "JDBC driver activation staged",
        message: `Restart the backend to activate ${disabledSet.version ? `version ${disabledSet.version}` : "the retained artifact set"}. The current version will be retained for rollback.`,
        severity: "info",
        actions: [{
          id: "core.queryengine.jdbc.restartBackend",
          label: "Restart backend",
          run: async () => {
            options.notifications.clear(restartNotification.id);
            await this.restartBackend();
          }
        }]
      });
    } else {
      this.setStatuses(this.statuses.map((status) => status.contribution.dialectId === dialectId ? result.status : status));
    }
    return result;
  }

  public async discardRetainedSet(dialectId: string, disabledSetId: string): Promise<JdbcDriverOperationResult> {
    const options = this.requireOptions();
    const contribution = options.contributions.find((entry) => entry.dialectId === dialectId);
    if (!contribution) throw new Error(`Unknown JDBC driver '${dialectId}'`);
    const currentStatus = this.statuses.find((entry) => entry.contribution.dialectId === dialectId)
      ?? (await this.refresh()).find((entry) => entry.contribution.dialectId === dialectId);
    const disabledSet = currentStatus?.disabledSets?.find((entry) => entry.id === disabledSetId);
    if (!currentStatus || !disabledSet) throw new Error(`Retained JDBC artifact set '${disabledSetId}' is unavailable`);
    const artifact = restoreArtifact(disabledSet, contribution.artifactId);
    artifact.warning = `Files moved to the Recycle Bin:\n${disabledSet.artifacts.map((entry) => entry.fileName).join("\n")}`;
    if (!await options.confirmOperation("discard", contribution, artifact)) {
      return { accepted: false, reason: "JDBC driver operation cancelled", status: currentStatus };
    }
    const result = await options.shell.discardJdbcDriverRetainedSet(contribution, disabledSetId);
    this.setStatuses(this.statuses.map((status) => status.contribution.dialectId === dialectId ? result.status : status));
    if (result.accepted) {
      options.notifications.notify({
        title: "Retained JDBC version removed",
        message: "The retained files were moved to the Recycle Bin. The active runtime was not changed.",
        severity: "success"
      });
    } else if (result.reason) {
      options.notifications.notify({ title: "Retained JDBC version removal failed", message: result.reason, severity: "error" });
    }
    return result;
  }

  public async restartBackend(): Promise<void> {
    const options = this.requireOptions();
    const result = await options.shell.restartBackendForJdbcDrivers();
    if (!result.accepted) {
      options.notifications.notify({
        title: "Backend restart deferred",
        message: result.reason || "The backend cannot restart while queries are active.",
        severity: "warning"
      });
      return;
    }
    await this.refresh();
    options.notifications.notify({
      title: "Backend restarted",
      message: "JDBC driver changes are active. The vault is locked; re-enter your password as needed.",
      severity: "success"
    });
  }

  public reset(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.options?.windowTarget?.removeEventListener("online", this.handleOnline);
    this.options?.documentTarget?.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.options = null;
    this.statuses = [];
    this.checkPromise = null;
    this.notifiedUpdatesThisSession.clear();
    this.emitChanged();
  }

  private async runOperation(
    dialectId: string,
    operation: "installJdbcDriver" | "updateJdbcDriver" | "removeJdbcDriver",
    verb: string,
    artifactId?: string
  ): Promise<JdbcDriverOperationResult> {
    const options = this.requireOptions();
    const contribution = options.contributions.find((entry) => entry.dialectId === dialectId);
    if (!contribution) {
      throw new Error(`Unknown JDBC driver '${dialectId}'`);
    }
    const operationName = operation === "installJdbcDriver"
      ? "install"
      : operation === "updateJdbcDriver" ? "update" : "remove";
    const currentStatus = this.statuses.find((entry) => entry.contribution.dialectId === dialectId)
      ?? (await this.refresh()).find((entry) => entry.contribution.dialectId === dialectId);
    const artifact = artifactsOf(currentStatus).find((entry) => entry.id === (artifactId ?? contribution.artifactId));
    if (!artifact) throw new Error(`JDBC driver artifact '${artifactId}' is unavailable`);
    if (!await options.confirmOperation(operationName, contribution, artifact)) {
      const status = currentStatus;
      if (!status) throw new Error(`JDBC driver status '${dialectId}' is unavailable`);
      return { accepted: false, reason: "JDBC driver operation cancelled", status };
    }
    const result = artifactId === undefined
      ? await options.shell[operation](contribution)
      : await options.shell[operation](contribution, artifactId);
    if (result.accepted) {
      await this.refresh();
      const restartNotification = options.notifications.notify({
        title: `JDBC driver ${verb}`,
        message: `Restart the backend to apply the ${artifact.displayName} change.`,
        severity: "info",
        actions: [{
          id: "core.queryengine.jdbc.restartBackend",
          label: "Restart backend",
          run: async () => {
            options.notifications.clear(restartNotification.id);
            await this.restartBackend();
          }
        }]
      });
    } else {
      this.setStatuses(this.statuses.map((status) =>
        status.contribution.dialectId === dialectId ? result.status : status));
    }
    return result;
  }

  private notifyAvailableUpdates(statuses: readonly JdbcDriverStatus[], notifyKnownUpdates: boolean): void {
    const options = this.requireOptions();
    for (const status of statuses) {
      for (const artifact of artifactsOf(status)) {
        if (artifact.managedWithPrimary && artifact.kind === "nativeLibrary") continue;
        if (!artifact.updateAvailable) continue;
        const version = artifact.latestVersion || "unknown";
        const notificationArtifactId = artifact.managedWithPrimary ? "package" : artifact.id;
        const key = `${UPDATE_NOTICE_SUPPRESSION_STORAGE_PREFIX}${status.contribution.dialectId}.${notificationArtifactId}.${version}`;
        if (options.storage?.getItem(key)) continue;
        if (!notifyKnownUpdates && this.notifiedUpdatesThisSession.has(key)) continue;
        this.notifiedUpdatesThisSession.add(key);
        const updateNotification = options.notifications.notify({
          title: artifact.managedWithPrimary
            ? `${status.contribution.displayName} package update available`
            : artifact.kind === "driver"
            ? `${status.contribution.displayName} update available`
            : `${status.contribution.displayName}: ${artifact.displayName} update available`,
          message: artifact.latestVersion ? `Version ${artifact.latestVersion} is available.` : "A newer version is available.",
          severity: "info",
          actions: [
            {
              id: `core.queryengine.jdbc.installAndRestart.${status.contribution.dialectId}.${notificationArtifactId}`,
              label: "Install and Restart Backend",
              run: async () => {
                const accepted = await this.installUpdate(status, artifact);
                if (!accepted) return;
                options.notifications.clear(updateNotification.id);
                await this.restartBackend();
              }
            },
            { id: "core.queryengine.jdbc.openDrivers", label: "Open JDBC Drivers", run: options.openSettings },
            {
              id: `core.queryengine.jdbc.suppressUpdate.${status.contribution.dialectId}.${notificationArtifactId}`,
              label: "Don't show again for this version",
              run: () => {
                options.storage?.setItem(key, "1");
                options.notifications.clear(updateNotification.id);
              }
            }
          ]
        });
      }
    }
  }

  private async installUpdate(status: JdbcDriverStatus, artifact: JdbcDriverArtifactStatus): Promise<boolean> {
    const options = this.requireOptions();
    const operation = artifact.source === "managed" ? "updateJdbcDriver" : "installJdbcDriver";
    const operationName = artifact.source === "managed" ? "update" : "install";
    if (!await options.confirmOperation(operationName, status.contribution, artifact)) return false;
    const result = artifact.id === status.contribution.artifactId
      ? await options.shell[operation](status.contribution)
      : await options.shell[operation](status.contribution, artifact.id);
    if (!result.accepted) {
      this.setStatuses(this.statuses.map((entry) =>
        entry.contribution.dialectId === status.contribution.dialectId ? result.status : entry));
      if (result.reason && !/cancelled/i.test(result.reason)) {
        options.notifications.notify({
          title: "JDBC driver update failed",
          message: result.reason,
          severity: "error"
        });
      }
      return false;
    }
    await this.refresh();
    return true;
  }

  private notifySqliteMigrationIfNeeded(): void {
    const options = this.requireOptions();
    if (options.storage?.getItem(SQLITE_MIGRATION_NOTICE_STORAGE_KEY)) return;
    const hasSqliteConnection = parseJdbcConnectionDefinitions(options.persistedConnections())
      .some((connection) => connection.dialectId === "sqlite");
    const sqliteStatus = this.statuses.find((status) => status.contribution.dialectId === "sqlite");
    if (!hasSqliteConnection || sqliteStatus?.source !== "missing") return;
    options.storage?.setItem(SQLITE_MIGRATION_NOTICE_STORAGE_KEY, "1");
    options.notifications.notify({
      title: "SQLite JDBC driver required",
      message: "SQLite is no longer bundled. Install it from JDBC Drivers settings before using SQLite connections.",
      severity: "info",
      actions: [{ id: "core.queryengine.jdbc.openDrivers", label: "Open JDBC Drivers", run: options.openSettings }]
    });
  }

  private async checkIfStale(): Promise<void> {
    const options = this.options;
    if (!options?.updateChecksEnabled() || this.checkPromise || this.lastKnownCheck() > this.now() - JDBC_DRIVER_CHECK_INTERVAL_MS) {
      return;
    }
    await this.checkNow();
    this.scheduleNextCheck();
  }

  private scheduleNextCheck(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.checkIfStale().finally(() => {
        if (this.options?.updateChecksEnabled()) this.scheduleNextCheck();
      });
    }, JDBC_DRIVER_CHECK_INTERVAL_MS);
  }

  private lastKnownCheck(): number {
    const stored = Number(this.options?.storage?.getItem(LAST_CHECK_STORAGE_KEY) ?? 0);
    const statusTimes = this.statuses.map((status) => Date.parse(status.lastCheckedAt ?? "")).filter(Number.isFinite);
    return Math.max(Number.isFinite(stored) ? stored : 0, ...statusTimes, 0);
  }

  private now(): number {
    return this.requireOptions().now?.() ?? Date.now();
  }

  private setStatuses(statuses: readonly JdbcDriverStatus[]): readonly JdbcDriverStatus[] {
    this.statuses = statuses;
    this.emitChanged();
    return statuses;
  }

  private emitChanged(): void {
    for (const listener of this.subscribers) listener();
  }

  private requireOptions(): JdbcDriverManagementOptions {
    if (!this.options) throw new Error("JDBC driver management service is not initialized");
    return this.options;
  }
}

function artifactsOf(status: JdbcDriverStatus | undefined): JdbcDriverArtifactStatus[] {
  if (!status) return [];
  return status.artifacts ?? [{
    id: status.contribution.artifactId,
    displayName: "JDBC JAR",
    kind: "driver",
    applicable: true,
    source: status.source,
    ...(status.installedVersion ? { installedVersion: status.installedVersion } : {}),
    ...(status.latestVersion ? { latestVersion: status.latestVersion } : {}),
    updateAvailable: status.updateAvailable,
    restartRequired: status.restartRequired,
    managementAvailable: status.managementAvailable,
    ...(status.pendingOperation ? { pendingOperation: status.pendingOperation } : {}),
    ...(status.error ? { error: status.error } : {})
  }];
}

function restoreArtifact(disabledSet: JdbcDriverDisabledSetStatus, artifactId: string): JdbcDriverArtifactStatus {
  return {
    id: artifactId,
    displayName: disabledSet.version ? `retained JDBC package ${disabledSet.version}` : "retained JDBC package",
    kind: "driver",
    applicable: true,
    source: disabledSet.artifacts[0]?.source ?? "manual",
    ...(disabledSet.version ? { installedVersion: disabledSet.version } : {}),
    updateAvailable: false,
    restartRequired: disabledSet.pendingRestore,
    managementAvailable: true
  };
}

const jdbcDriverManagementService = new JdbcDriverManagementService();

export function getJdbcDriverManagementService(): JdbcDriverManagementService {
  return jdbcDriverManagementService;
}

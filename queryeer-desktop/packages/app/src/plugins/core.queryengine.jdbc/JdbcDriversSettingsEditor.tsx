import { useEffect, useState } from "react";
import { pathToFileUri } from "@queryeer/api/files/Resolvers";
import type { JdbcDriverStatus } from "@queryeer/api/queryengine/JdbcDriverExtension";
import { getJdbcDriverManagementService } from "./jdbc-driver-management-service";
import "./jdbc-settings.css";

type Props = { readonly: boolean };

export function JdbcDriversSettingsEditor({ readonly }: Props): JSX.Element {
  const service = getJdbcDriverManagementService();
  const [statuses, setStatuses] = useState<readonly JdbcDriverStatus[]>(service.getStatuses());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => service.subscribe(() => setStatuses(service.getStatuses())), [service]);

  const run = async (id: string, action: () => Promise<unknown>): Promise<void> => {
    setBusy(id);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  const openDriverFolder = async (): Promise<void> => {
    const appDir = await window.appShell.getAppDir();
    const separator = appDir.includes("\\") ? "\\" : "/";
    await window.appShell.openPath(pathToFileUri(`${appDir}${separator}libShared`));
  };

  const restartRequired = statuses.some((status) => status.restartRequired
    || status.artifacts?.some((artifact) => artifact.restartRequired));
  return (
    <div className="jdbc-driver-settings" aria-live="polite">
      <div className="jdbc-driver-toolbar">
        <button className="jdbc-settings-button" disabled={busy !== null} onClick={() => void run("check", () => service.checkNow(true))}>Check now</button>
        <button className="jdbc-settings-button" onClick={() => void openDriverFolder()}>Open driver folder</button>
        {restartRequired && (
          <button className="jdbc-settings-button" disabled={readonly || busy !== null} onClick={() => void run("restart", () => service.restartBackend())}>Restart backend</button>
        )}
      </div>
      {statuses.length === 0 && <div className="jdbc-settings-empty">No JDBC driver contributions are registered.</div>}
      <div className="jdbc-driver-list">
        {statuses.map((status) => {
          const id = status.contribution.dialectId;
          const artifacts = (status.artifacts ?? [{
            id: status.contribution.artifactId,
            displayName: "JDBC JAR",
            kind: "driver" as const,
            applicable: true,
            source: status.source,
            installedVersion: status.installedVersion,
            latestVersion: status.latestVersion,
            updateAvailable: status.updateAvailable,
            restartRequired: status.restartRequired,
            managementAvailable: status.managementAvailable,
            pendingOperation: status.pendingOperation,
            error: status.error
          }]).filter((artifact) => artifact.applicable);
          const activeVersion = artifacts.find((artifact) => artifact.kind === "driver")?.installedVersion;
          return (
            <section className="jdbc-driver-card" key={`${status.contribution.ownerPluginId}:${id}`} aria-label={status.contribution.displayName}>
              <div className="jdbc-driver-summary">
                <strong>{status.contribution.displayName}</strong>
              </div>
              <div className="jdbc-driver-group jdbc-driver-group-active">
                <div className="jdbc-driver-group-heading">
                  <strong>Active runtime</strong>{" "}
                  <span className="jdbc-driver-active-version">{activeVersion ? `Version ${activeVersion}` : "No active version"}</span>
                </div>
                {artifacts.map((artifact) => {
                const busyId = `${id}:${artifact.id}`;
                const working = busy === busyId;
                return <div className="jdbc-driver-artifact" key={artifact.id}>
                  <div className="jdbc-driver-summary">
                    <strong>{artifact.displayName}</strong>
                    <span className={`jdbc-driver-source source-${artifact.source}`}>{artifact.source}</span>
                    {artifact.pendingOperation && <span className="jdbc-driver-pending">{artifact.pendingOperation} pending restart</span>}
                  </div>
                  <div className="jdbc-driver-versions">
                    <span>Active: {artifact.installedVersion || "Not installed"}</span>
                    <span>Latest: {artifact.latestVersion || "Not checked"}</span>
                  </div>
                  {artifact.managedWithPrimary && artifact.kind === "nativeLibrary" && (
                    <div className="jdbc-settings-help">Managed with the JDBC JAR as one version-locked package.</div>
                  )}
                  {artifact.versionMismatch && (
                    <div className="jdbc-settings-error" role="status">The version-locked JDBC package is incomplete or mismatched.</div>
                  )}
                  {artifact.warning && <div className="jdbc-settings-warning" role="status">{artifact.warning}</div>}
                  {artifact.error && <div className="jdbc-settings-error" role="status">{artifact.error}</div>}
                  {!artifact.managementAvailable && <div className="jdbc-settings-help">Automatic management is unavailable for this contribution.</div>}
                  <div className="jdbc-driver-actions">
                    {artifact.managementAvailable && (!artifact.managedWithPrimary || artifact.kind === "driver") && (artifact.source === "missing" || artifact.source === "manual") && (
                      <button className="jdbc-settings-button" disabled={readonly || working || artifact.pendingOperation !== undefined} aria-label={`Install ${artifact.managedWithPrimary ? `${status.contribution.displayName} package` : artifact.displayName}`} onClick={() => void run(busyId, () => service.install(id, artifact.id))}>{artifact.managedWithPrimary ? "Install package" : "Install"}</button>
                    )}
                    {artifact.managementAvailable && (!artifact.managedWithPrimary || artifact.kind === "driver") && artifact.source === "managed" && artifact.updateAvailable && (
                      <button className="jdbc-settings-button" disabled={readonly || working || artifact.pendingOperation !== undefined} aria-label={`Update ${artifact.managedWithPrimary ? `${status.contribution.displayName} package` : artifact.displayName}`} onClick={() => void run(busyId, () => service.update(id, artifact.id))}>{artifact.managedWithPrimary ? "Update package" : "Update"}</button>
                    )}
                    {artifact.managementAvailable && (!artifact.managedWithPrimary || artifact.kind === "driver") && artifact.source === "managed" && (
                      <button className="jdbc-settings-button" disabled={readonly || working || artifact.pendingOperation !== undefined} aria-label={`Remove ${artifact.managedWithPrimary ? `${status.contribution.displayName} package` : artifact.displayName}`} onClick={() => void run(busyId, () => service.remove(id, artifact.id))}>{artifact.managedWithPrimary ? "Remove managed package" : "Remove managed"}</button>
                    )}
                  </div>
                </div>;
                })}
              </div>
              {(status.disabledSets?.length ?? 0) > 0 && <div className="jdbc-driver-group jdbc-driver-group-retained">
                <div className="jdbc-driver-group-heading">
                  <strong>Retained versions</strong>{" "}
                  <span>{status.disabledSets?.length}</span>
                </div>
                <div className="jdbc-settings-help">Activating a retained version moves the current active version here for rollback. Only one version remains active.</div>
                {status.disabledSets?.map((disabledSet) => {
                  const busyId = `${id}:restore:${disabledSet.id}`;
                  return <div className="jdbc-driver-artifact" key={disabledSet.id}>
                    <div className="jdbc-driver-summary">
                      <strong>{disabledSet.version ? `Version ${disabledSet.version}` : "Unknown version"}</strong>
                      <span className="jdbc-driver-source">retained</span>
                      {disabledSet.pendingRestore && <span className="jdbc-driver-pending">activation pending restart</span>}
                    </div>
                    <div className="jdbc-driver-disabled-files">
                      {disabledSet.artifacts.map((artifact) => <span key={`${artifact.artifactId}:${artifact.fileName}`}>
                        {artifact.fileName} ({artifact.source})
                      </span>)}
                    </div>
                    <div className="jdbc-settings-help">Retained {new Date(disabledSet.disabledAt).toLocaleString()}</div>
                    <div className="jdbc-settings-help">{disabledSet.reason}</div>
                    <div className="jdbc-driver-actions">
                      <button
                        className="jdbc-settings-button"
                        disabled={readonly || busy !== null || disabledSet.pendingRestore || !disabledSet.restorable}
                        aria-label={`Activate ${status.contribution.displayName} ${disabledSet.version ?? "retained artifacts"}`}
                        onClick={() => void run(busyId, () => service.restore(id, disabledSet.id))}
                      >Activate</button>
                      <button
                        className="jdbc-settings-button"
                        disabled={readonly || busy !== null || disabledSet.pendingRestore}
                        aria-label={`Move ${status.contribution.displayName} ${disabledSet.version ?? "retained artifacts"} to Recycle Bin`}
                        onClick={() => void run(`${busyId}:discard`, () => service.discardRetainedSet(id, disabledSet.id))}
                      >Move to Recycle Bin</button>
                      {!disabledSet.restorable && <span className="jdbc-settings-help">A matching JDBC JAR is required for safe activation.</span>}
                    </div>
                  </div>;
                })}
              </div>}
              <div className="jdbc-driver-actions">
                {status.contribution.downloadPageUrl && (
                  <button className="jdbc-settings-button" onClick={() => void window.appShell.openExternal(status.contribution.downloadPageUrl!)}>Open download page</button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

# JDBC Driver Management

Queryeer loads JDBC driver JARs from `libShared` and managed native companion libraries from `libNative` in the application user-data directory. PostgreSQL, SQL Server, and SQLite drivers are not bundled with their dialect plugins.

## User Workflow

Open **Settings > Query Engine > JDBC > JDBC Drivers** to inspect drivers contributed by installed frontend plugins.

- Each card has separate artifact status rows. SQL Server shows `JDBC JAR` and, on Windows x64/x86, `Windows Native Authentication`; these two artifacts are version-locked and managed as one package.
- `Install` downloads the latest compatible stable artifact release.
- `Update` stages a newer compatible release for a Queryeer-managed driver.
- `Remove managed` stages removal without deleting manually supplied JARs.
- Conflicting or superseded provider files are moved to a provider-specific `disabled` folder and remain available from the driver card.
- `Activate` switches to a retained artifact set and moves the currently active set back to retained storage for rollback. The versions are never loaded together.
- `Move to Recycle Bin` removes an unused retained version without restarting the backend. The confirmation lists every affected file.
- `Restart backend` activates pending changes without reloading the Electron window.
- `Check now` refreshes release information immediately.

Driver update checks run after application startup and every 24 hours while the application remains open. An overdue check also runs when the renderer returns online or becomes visible. The setting `core.queryengine.jdbc.driverUpdateCheck.enabled` disables automatic checks but does not disable `Check now`.

An available-version notification is shown at most once per application session by default and can return after restart if it was merely closed. Choosing `Don't show again for this version` persists suppression for that specific driver, artifact, and release; a later release or different companion can still produce a notification.

The backend restart is deferred while queries are active. Restarting the backend preserves the desktop window and open editors, but locks the security vault. Unlock the vault again before using credentials stored as secret references.

SQLite was previously bundled. When a saved SQLite connection exists but no SQLite driver is detected, Queryeer shows a one-time notice directing the user to JDBC Drivers settings. It does not silently download the driver.

## Storage And Integrity

Managed drivers are downloaded from Maven Central over HTTPS. The desktop main process:

1. Resolves stable versions from Maven metadata and applies the dialect's compatibility filter.
2. Enforces time and size limits.
3. Verifies the Maven Central SHA-256 sidecar, with SHA-1 fallback for artifacts that Maven Central publishes without a SHA-256 sidecar.
4. Validates that the JAR contains the declared JDBC driver class.
5. Stages changes below `libShared/.jdbc-staging`.
6. Applies changes only before backend startup or while the backend is stopped.

Managed and disabled-artifact state is stored in `settings/jdbc-drivers.json`. Queryeer never deletes manually supplied JARs or native libraries.

Before every backend startup, Queryeer inspects top-level provider artifacts. A selected inventory-managed artifact wins only when its recorded hash still matches. Without a managed artifact, the newest compatible manual version with an identifiable version is selected. Matching version-locked companions are selected with that JAR. All other provider files are transactionally moved below `libShared/disabled/<dialect>/...` or `libNative/disabled/<dialect>/...`, which the backend does not scan. If several manual JAR versions cannot be identified, Queryeer fails closed by disabling all of them instead of relying on classpath filename order.

Disabled SQL Server JARs and matching authentication DLLs are retained as one version set. The JDBC Drivers settings page lists retained filenames, source, version, and reason. Activation is applied only while Java is stopped; the active set is moved to retained storage before the selected set returns to its original top-level paths. File hashes and containment are validated before activation, and failed moves are rolled back. Disable and activation move plans are persisted before the first rename, allowing startup to finish an operation interrupted by process or machine failure.

SQL Server native authentication is a `versionLockedToDriver` companion. Installing, updating, or removing either artifact operates on the entire SQL Server package. The main process resolves one Maven version, maps a version such as `13.4.0.jre11` to release `13.4.0`, requests the fixed `microsoft/mssql-jdbc` GitHub tag `v13.4.0`, and selects only `mssql-jdbc_auth.zip`. It requires GitHub's `sha256:` asset digest, verifies the complete archive, extracts only `{arch}/mssql-jdbc_auth-{releaseVersion}.{arch}.dll`, and validates the `MZ` header.

All package downloads and validations finish before either member is recorded as pending. Pending members share one bundle ID. On restart, Queryeer prevalidates every staged/final member before promotion and updates inventory only after the whole package is active. Matching final hashes support recovery if a previous startup stopped partway through promotion. Package removal likewise removes both managed members together.

Pending DLL changes are staged below `libShared/.jdbc-staging` and applied to `libNative` only while the backend is stopped or during startup. Managed filenames contain `.queryeer-managed.` and still match the backend manifest glob. Superseded inventory-owned package members are removed during a successful managed update; unknown or orphaned files, including managed-looking filenames, are retained in disabled storage. Manual DLLs are never deleted. Reconciliation therefore leaves at most one active SQL Server JAR and one matching native authentication DLL in the top-level runtime directories.

## Plugin Contributions

Frontend plugins opt in through `PluginContext.jdbcDrivers`:

```ts
context.jdbcDrivers.registerDriver({
  dialectId: "example",
  displayName: "Example JDBC Driver",
  groupId: "com.example",
  artifactId: "example-jdbc",
  driverClassName: "com.example.jdbc.Driver",
  compatibleVersionRegex: "\\.jre11$",
  downloadPageUrl: "https://example.com/jdbc"
});
```

The host associates the contribution with the activating plugin ID; plugins cannot select their recorded owner. Contributions and optional `companionArtifacts` are displayed by the common UI and participate in per-artifact status/update infrastructure. Companion declarations include identity, native kind, platforms, GitHub release archive source and version mapping, exact archive entry template, target directory, expected extension, and optional `versionLockedToDriver`. Applicable locked companions share lifecycle actions and cannot be independently managed.

Automatic downloads are initially restricted to an allowlist of Queryeer's built-in PostgreSQL, SQL Server, and SQLite contributions. The main process owns and overrides all trusted metadata, including SQL Server companion metadata. PostgreSQL and SQLite have no companions. External contributions remain visible, including declared companions, but `managementAvailable` is false. Enabling automatic installation for external plugins requires an explicit trust and permission policy because JARs and native libraries execute inside the Java backend.

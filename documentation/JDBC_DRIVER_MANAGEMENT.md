# JDBC Driver Management

Queryeer loads JDBC driver JARs from `libShared` and managed native companion libraries from `libNative` in the application user-data directory. No dialect bundles its driver: not the built-in SQL Server dialect, and not dialect plugins such as PostgreSQL and SQLite (moved out of core in 0.24) and MySQL.

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

JAR versions are read from `Implementation-Version` or `Bundle-Version`, with the artifact filename as fallback, including Queryeer-managed filenames. On startup, if an inventory-owned version-locked companion was previously moved into a native-only retained set, Queryeer restores the newest hash-, path-, and version-matched managed file to repair the package; duplicate retained copies remain available for explicit cleanup. Legacy `.queryeer-managed.dll` files are migrated to Microsoft's canonical native-library filename so the JDBC driver's later `System.loadLibrary` lookup resolves the preloaded library. Ownership of canonical filenames is tracked by inventory path and hash. A same-version package update is also allowed when any recorded package member is missing or fails its recorded hash.

Disabled SQL Server JARs and matching authentication DLLs are retained as one version set. The JDBC Drivers settings page lists retained filenames, source, version, and reason. Activation is applied only while Java is stopped; the active set is moved to retained storage before the selected set returns to its original top-level paths. File hashes and containment are validated before activation, and failed moves are rolled back. Disable and activation move plans are persisted before the first rename, allowing startup to finish an operation interrupted by process or machine failure.

SQL Server native authentication is a `versionLockedToDriver` companion. Installing, updating, or removing either artifact operates on the entire SQL Server package. The main process resolves one Maven version, maps a version such as `13.4.0.jre11` to release `13.4.0`, requests the fixed `microsoft/mssql-jdbc` GitHub tag `v13.4.0`, and selects only `mssql-jdbc_auth.zip`. The versions must match exactly: the driver loads the library by a name built from its own version (`13.6.3.jre11` loads `mssql-jdbc_auth-13.6.3.x64`), so a library from another release never loads and Windows authentication fails with "This driver is not configured for integrated authentication". When the newest driver's tag is missing, because a patch reached Maven Central before its GitHub release, the package is the newest driver version whose tag exists; for example, with `13.6.1.jre11` on Maven Central and only `v13.6.0` on GitHub, the package is `13.6.0.jre11` with the `v13.6.0` library, and `13.6.1` becomes the update once its release is published. A package whose library doesn't match its driver, which earlier versions could install, shows as a version mismatch, and its update installs a matching pair. The service requires GitHub's `sha256:` asset digest, verifies the complete archive, extracts only `{arch}/mssql-jdbc_auth-{releaseVersion}.{arch}.dll`, and validates the `MZ` header.

All package downloads and validations finish before either member is recorded as pending. Pending members share one bundle ID. On restart, Queryeer prevalidates every staged/final member before promotion and updates inventory only after the whole package is active. Matching final hashes support recovery if a previous startup stopped partway through promotion. Package removal likewise removes both managed members together.

Pending DLL changes are staged below `libShared/.jdbc-staging` and applied to `libNative` only while the backend is stopped or during startup. Managed SQL Server DLLs retain Microsoft's canonical filename and are identified through the inventory path and hash. Superseded inventory-owned package members are removed during a successful managed update; unknown or orphaned files are retained in disabled storage. Manual DLLs are never deleted. Reconciliation therefore leaves at most one active SQL Server JAR and one matching native authentication DLL in the top-level runtime directories.

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

Core manages any registered driver. Because JARs and native libraries execute inside the Java backend, the first install of a plugin's driver needs the user's consent:

- Every driver is a plugin's since 0.24, when SQL Server, PostgreSQL and SQLite moved out of core, and the user approves it. Until then core's SQL Server driver was approved without asking. A driver installed while one of them was built in is re-keyed to its plugin when the inventory is read (`MOVED_BUILTIN_DRIVER_OWNERS`), so approving the plugin's driver adopts it, with SQL Server's native authentication library.
- Any other contribution reports `approvalRequired: true` until the user approves it. Before its first install or update, the settings UI shows an approval dialog (`core.dialog`) in place of the usual confirmation. It names the owning plugin, the driver class, the Maven Central coordinates and compatibility filter, every companion's GitHub repository and asset, and the licence or download page. On confirm, the renderer calls `approveJdbcDriver`, and the main process records the approval; install and update refuse a contribution without one.
- The approval is consent, not a security boundary: plugin frontends run in the same renderer, which can already reach the main process through `window.appShell`. The main process still owns the approvals, the refusal of unapproved drivers and every download check.
- An approval is stored in `settings/jdbc-drivers.json` with the declaration as it was approved. A later declaration that changes what is downloaded (coordinates, driver class, compatibility filter or companion source) asks again; a changed display name or download page does not.
- Declining installs nothing. Downloads stay Maven Central and GitHub release assets only, with the checks described above.
- Core refuses to manage a contribution that would clash with one it already manages, and says why in the status warning (`managementAvailable: false`). The checks are:
  - it claims a built-in's plugin ID and dialect with different coordinates;
  - another managed contribution already uses its driver class, because startup could not tell their jars apart (such a plugin can rely on the jar the other driver installs);
  - one of its native companions has file names that overlap another managed contribution's.
- Startup reconciliation, retained sets and activation run for built-in and approved contributions.

The backend receives the driver classes of built-in and approved contributions as `-Dqueryeer.jdbc.driverClasses`. For each of those classes it loads one JAR from `libShared`: the managed one if present, otherwise the newest by `Implementation-Version`. JARs of other drivers are all loaded.

A native companion is installed under the file name of its archive entry (the last segment of `archiveEntryTemplate`, with `{releaseVersion}` and `{arch}` filled in), because that is the name its driver loads it by. Queryeer recognises manually supplied files of the same companion by the template's fixed prefix, e.g. `mssql-jdbc_auth` for `mssql-jdbc_auth-{releaseVersion}.{arch}.dll`, and reads their version from the template. A companion's file name template must therefore start with a fixed prefix of at least three characters, contain `{releaseVersion}`, and end in `expectedFileExtension`. The pre-2019 SQL Server name `sqljdbc_auth.dll` is no longer recognised.

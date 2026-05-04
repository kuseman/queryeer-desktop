# Session Handoff

## What changed in this session

### Generated stable `connectionId` for JDBC and Elasticsearch connections

**Problem:** `connectionId` was previously a user-defined string that served as both the technical key and the display name. Renaming a connection orphaned schema crawl caches (stored by `connectionId` in H2 filenames) and broke workspace/engine bindings.

**Solution:** `connectionId` is now a frontend-generated UUID v4 (`crypto.randomUUID()`). The human-readable label lives in `name`/`title` and is purely cosmetic.

#### Frontend changes

- **New utility:** `src/core/utils/ids.ts` — `generateConnectionId()` returns `crypto.randomUUID()`.
- **JDBC settings editor** (`JdbcConnectionsSettingsEditor.tsx`):
  - `connectionId` input field hidden from the detail form.
  - `addRow()` and `cloneRow()` auto-generate a fresh UUID via `generateConnectionId()`.
  - List item labels use `title.trim() || "Untitled connection"` instead of `connectionId`.
  - Removed `buildCloneConnectionId()` (no longer needed).
  - Simplified `buildRowErrors()` — no longer validates `connectionId` uniqueness or emptiness.
- **ES settings editor** (`ElasticsearchConnectionsSettingsEditor.tsx`): same pattern as JDBC.
- **ES catalog contribution** (`elasticsearch-catalog-contribution.tsx`):
  - `resolveRuntimeProperties` no longer expands credentials into the engine state. It returns properties as-is (only `connectionId` + `index` are persisted).
  - `loadIndices` now sends `{ properties: { connectionId } }` to the backend instead of expanded endpoint/auth fields.
- **JDBC connection selector** (`JdbcConnectionSelector.tsx`): display fallback changed from `c.title ?? c.connectionId` to `c.title ?? "Untitled connection"`.
- **JDBC navigation store** (`jdbc-navigation-store.ts`): same display fallback for connection root nodes.
- **Protocol fixtures** updated to use UUID-style `connectionId` values.

#### Backend changes

- **`ConnectionUpsertRequestHandler.java`**: rejects blank/null `connectionId` with `BackendErrorCode.VALIDATION` instead of auto-generating `"conn-" + envelope.id()`.
- **Tests updated** across `ProtocolFixtureCompatibilityTest`, `ElasticsearchCatalogProviderTest`, `JdbcBackendPluginTest`, `JdbcSettingsConnectionSourceTest`, `ConnectionUpsertRequestHandlerTest`, and `ConnectionUpsertRequestHandlerTest` to provide explicit `connectionId` values.

#### Validation

- Desktop: `npm run typecheck && npm run lint && npm run build && npm run test` — all green (625 passed, 10 skipped).
- Backend: `./mvnw -f queryeer-backend/pom.xml clean verify` — all green.
- Protocol fixture check script (`scripts/backend-protocol-fixtures-check.mjs`) passes.

### FileBasedConfigService cache TTL fix

**Problem:** `FileBasedConfigService.getModule()` relied solely on mtime comparison for cache invalidation. On Windows, filesystem mtime can truncate to milliseconds (`FileTime.toMillis()`), causing the backend to miss settings changes that happen within the same millisecond window — common when the desktop writes settings atomically (temp + rename).

**Solution:** Added a 1-second cache TTL (`MAX_CACHE_AGE_MS = 1000L`). The `CachedModule` record now stores `cachedAt` (timestamp when the entry was created). `getModule()` returns the cached module only if **both** mtime is unchanged **and** the cache entry is younger than the TTL. This ensures stale data is never held for more than 1 second, regardless of filesystem mtime resolution.

**Files changed:**
- `FileBasedConfigService.java` — added `MAX_CACHE_AGE_MS`, `cachedAt` field to `CachedModule`, updated cache hit/miss logic
- `FileBasedConfigServiceTest.java` — added `getModuleReReadsWhenCacheAgeExceedsMaxTtl()` test

## Known gaps / temporary scaffolds

- No migration path for old settings — users must clear appDir/start fresh (acceptable per user: "no backward compatibility needed").
- Old H2 schema cache files from previous `connectionId` values will simply be orphaned on disk until manual cleanup.

---

## Removed `FileMediator.executeFile`

**Rationale:** `FileMediator.executeFile()` was dead code — no production caller existed. Programmatic execution should go through `QueryEngineService.execute()` which handles vault retry, engine resolution, and event routing properly. Removing it eliminates a broken/less-capable alternative that would silently fail on locked vaults.

**Files changed:**
- `contracts/files/FileMediator.ts` — removed `executeFile` from interface and deleted `FileExecuteResult` type.
- `core/plugin-runtime/FileMediator.ts` — removed `executeFile` implementation, `BackendQueryExecutor` type, `executeBackendQuery` option, `generateQueryExecutionId` option.
- `core/plugin-runtime/PluginHost.ts` — removed `executeBackendQuery` from `PluginHostOptions` and `createFileMediator` call.
- `renderer/shell/bootstrap.ts` — removed `executeBackendQuery` from `PluginHost` constructor.
- `core/plugin-runtime/FileMediator.test.ts` — removed `executeFile` tests and cleaned up harness.
- `renderer/workspace/workspace-service.test.ts` — removed `executeBackendQuery` from `createFileMediator` call.
- 5 plugin test files — removed `executeFile: vi.fn()` from mock `fileMediator` objects.

## Lazy secret materialization and vault-unlock deferral

**Problem:** Secrets were eagerly materialized on both frontend (`runWithSecretsUnlocked` scanned payloads for `secretRef` before every backend call) and backend (`FileBasedConfigService.getModule()`, `QueryExecutionService`, `EngineInvokeService`, and `JdbcResolvedConnection` all eagerly resolved `secretRef` wrappers). This forced users to unlock the vault even for operations that never actually needed a secret (e.g., JDBC with Windows native auth).

**Solution:** Defer secret materialization until the exact moment a plaintext secret is required (right before `DriverManager.getConnection`). Introduce a dedicated `SECURITY_SESSION_CLOSED` error code so the frontend can catch it, show the unlock dialog, and retry.

### Frontend changes

- **`src/contracts/backend/ErrorCode.ts`**: added `"SECURITY_SESSION_CLOSED"` to `BackendErrorCode`.
- **`src/plugins/core.security/service.ts`**:
  - Replaced `runWithSecretsUnlocked(payload, action)` with `withVaultRetry(operation, options?)`.
  - Removed client-side `secretRef` scanning (`containsSecretRef`).
  - `withVaultRetry` catches errors containing `SECURITY_SESSION_CLOSED`, prompts for unlock via `ensureUnlockedForSecretAccess`, and retries the operation once if unlocked.
- **`src/plugins/core.queryengine/QueryEngineService.ts`**:
  - Replaced `runWithSecretsUnlocked` wrapper with `withVaultRetry` in both `execute()` and `invoke()`.
- **Tests updated** in `service.test.ts` and `QueryEngineService.test.ts` to cover retry success, retry cancellation, and locked-state failure.
- **`QueryEditorComponent.tsx`** (type fix): corrected `error: p.error` to `error: p.error ?? null` at line 284 to satisfy `updateOutputContextForFile`'s `error: { code: string; message: string } | null` type.

### Backend changes

- **`BackendErrorCode.java`**: added `SECURITY_SESSION_CLOSED`.
- **`SecuritySessionClosedException.java`** (new in `backend-api`): standalone exception thrown when `SecretRefPayloadResolver` attempts to decrypt while the session is closed.
- **`SecretRefPayloadResolver.java`**: throws `SecuritySessionClosedException` (instead of generic `SecretResolutionException`) when `session.isOpen() == false`.
- **`FileBasedConfigService.java`**:
  - Removed eager `resolveSecrets()` from `getModule()` — modules now return raw values with `secretRef` wrappers intact.
  - `materializeSecrets()` now propagates exceptions (no longer swallows `SecretResolutionException`).
- **`QueryExecutionService.java`**: removed eager `secretResolver.materialize(engineState)`. Catches `SecuritySessionClosedException` and emits `publisher.failed("SECURITY_SESSION_CLOSED", ...)`.
- **`EngineInvokeService.java`**: removed eager `secretResolver.materialize(params.payload())`. Catches `SecuritySessionClosedException` and throws `EngineInvokeException(BackendErrorCode.SECURITY_SESSION_CLOSED, ...)`.
- **JDBC plugin**:
  - **`JdbcCredentialResolver.java`** (new): centralizes lazy materialization of `JdbcConnectionProfile` properties.
  - **`JdbcResolvedConnection.java`**: removed `ConfigService` dependency and eager `materialize()` calls. Profiles are built with raw properties.
  - **`JdbcConnectionResolver.java`**: simplified to return `JdbcConnectionProfile` directly (no `Optional`).
  - **`JdbcQueryEngineProvider.java`**: injects `JdbcCredentialResolver`; materializes profiles in `execute()`, `connectionTest()`, and `schemaFetch()` right before use.
  - **`JdbcSchemaCrawler.java`**: injects `JdbcCredentialResolver`; materializes profile before calling `schemaResolver().resolveSchema()`.
  - **`JdbcSchemaCrawlCoordinator.java`**:
    - Removed `securitySessionState.isOpen()` gates from background `loop()` and `onConnectionUpsert()`.
    - Background crawls silently swallow `SecuritySessionClosedException` (no log spam).
    - `refreshNow()` propagates `SecuritySessionClosedException` to the caller so the frontend can show the unlock dialog.
  - **`JdbcBackendPlugin.java`**: wired `JdbcCredentialResolver` into all components.
- **Tests updated** across `SecretRefPayloadResolverTest`, `FileBasedConfigServiceTest`, `QueryExecutionServiceTest`, `JdbcResolvedConnectionTest`, and `JdbcBackendPluginTest`.

### Protocol docs

- **`BACKEND_PROTOCOL.md`**:
  - Added `SECURITY_SESSION_CLOSED` to error codes list.
  - Updated security constraints section to describe lazy resolution and retry behavior.

### Validation

- Desktop: `npm run typecheck && npm run lint && npm run build && npm run test && npm run test:integration` — all green (626 passed, 10 skipped; integration 8 passed, 2 skipped). One pre-existing unhandled rejection from `bootstrap.test.ts` timer teardown (unrelated).
- Backend: `./mvnw -f queryeer-backend/pom.xml -DskipTests=true clean verify` — all green.
- Full backend test suite (`./mvnw -f queryeer-backend/pom.xml test`) — all green (103 tests passed).

# JDBC Schema Crawl Implementation Plan

Status: In progress
Scope: Implement backend JDBC schema crawl core with dialect-specific extraction, durable per-connection schema cache, and startup preload from shared desktop settings.

## Goals

- Build a reusable crawl subsystem in `backend-plugin-jdbc` used by code completion and schema visualization.
- Keep crawl mechanics in core, while dialects only implement how schema data is read.
- Persist crawl results in one H2 database per `connectionId`.
- Use usage-based decay so hot connections crawl frequently and cold connections back off to disabled/off.
- Allow backend startup crawl without requiring the user to run a query first.
- Protect frontend/backend JDBC settings shape parity with shared fixtures.

## Architecture

### Core components (backend-plugin-jdbc)

- `SchemaCrawlCoordinator`
  - Schedules crawl checks and dispatches due work.
  - Applies decay/backoff policy.
  - Tracks usage signals from query execution and file binding events.
- `SchemaCrawler`
  - Resolves runtime connection profile.
  - Delegates extraction to `JdbcDialect.schemaResolver()`.
  - Writes normalized graph to schema store.
- `SchemaStore`
  - Owns per-connection H2 lifecycle and schema migrations.
  - Exposes upsert/soft-delete and latest snapshot read API.
- `CrawlPolicy`
  - Computes `next_due_at` from usage score, failures, and enablement.
- `JdbcConnectionCatalog`
  - Merges configured connections (desktop settings) and runtime upserts.

### Dialect responsibilities

- Generic base dialect (`jdbc`) uses `INFORMATION_SCHEMA`.
- Vendor dialects can provide richer extraction or compatibility overrides.
- Dialects do not decide schedule/storage policy.

## Persistence model (H2 per connection)

Database location: `${queryeer.jdbc.schemaCache.dir}/${sanitizedConnectionId}.mv.db`

Tables:

- `crawl_run`
  - Run metadata and status.
- `schema_object`
  - Universal object graph nodes:
    - `TABLE`, `VIEW`, `INDEX`, `PRIMARY_KEY`, `UNIQUE_KEY`, `FOREIGN_KEY`, `CHECK_CONSTRAINT`, `SEQUENCE`, etc.
  - Includes lineage (`first_seen_run_id`, `last_seen_run_id`, `is_deleted`).
- `object_column`
  - Ordered column metadata for table/view-like objects.
- `object_reference`
  - Ordered edges for memberships and links:
    - index -> columns
    - constraint -> columns
    - fk -> target table/target columns
- `crawl_state`
  - Scheduler state (`last_success_at`, `consecutive_failures`, `usage_score`, `next_due_at`, `enabled`).

## Crawl decay policy

- Usage score: exponential moving average (half-life 7 days).
- Target intervals:
  - hot: 5-15 min
  - warm: 1-6 h
  - cold: 1-7 d
  - disabled: off
- Failure backoff: x2 per consecutive failure (capped).
- Add jitter to avoid synchronized bursts.

## Backend startup preload

### Source of truth

- Backend reads desktop settings module document for `core.queryengine.jdbc`.
- Connection definitions source key: `core.queryengine.jdbc.connections`.

### Bootstrap config wiring

- Desktop main process passes:
  - `QUERYEER_APP_DIR`
  - `QUERYEER_SETTINGS_DIR`
  - optional `QUERYEER_SETTINGS_PATH`
- Backend runner maps these to config keys:
  - `queryeer.app.dir`
  - `queryeer.settings.dir`
  - `queryeer.settings.path`

### Plugin activation flow

1. Discover/register JDBC dialects.
2. Read configured JDBC connections from settings.
3. Upsert enabled/valid connections into `JdbcConnectionRegistry`.
4. Start crawl scheduler and enqueue due connections.

## Fixture parity strategy

Shared fixture folder:

- `protocol-fixtures/jdbc/connection-settings.json`

Coverage:

- Valid rows with `secretRef` wrapper.
- Duplicate IDs (first wins).
- Missing required values dropped.
- Defaulting behavior (`dialectId`, `enabled`).

Tests:

- Frontend parser test reads shared fixture and asserts normalized entries.
- Backend parser test reads the same fixture and asserts identical normalization semantics.

## Delivery phases

1. Bootstrap config propagation (desktop spawn -> backend config service).
2. Shared JDBC settings fixture + parser compatibility tests.
3. Backend settings reader + connection preload integration.
4. Crawl policy + scheduler scaffolding with tests.
5. H2 schema store migration and repository tests.
6. Base INFORMATION_SCHEMA resolver and integration tests.
7. Documentation updates in `BACKEND_PROTOCOL.md`.

## Validation checklist

- Desktop: `npm run typecheck && npm run lint && npm run build && npm run test:integration`
- Backend: `./mvnw -f queryeer-backend/pom.xml -DskipTests=true clean verify`

# Queryeer Backend

Standalone Java backend reactor for Queryeer Desktop.

## Modules

- `backend-api`: plugin SPI and injected service interfaces
- `backend-contract`: protocol DTOs/envelopes
- `backend-core`: plugin runtime and startup validation
- `backend-transport-stdio`: stdio protocol adapter scaffold
- `backend-runner`: executable bootstrap/wiring
- `backend-plugin-payloadbuilder`: payloadbuilder query engine plugin
- `backend-plugin-jdbc`: JDBC query engine plugin
- `backend-plugin-dialect-sqlserver`: SQL Server JDBC dialect plugin

## Build

From repository root:

```bash
./mvnw -f queryeer-backend/pom.xml clean verify
```

Prepare the development backend runner and builtin plugins without tests:

```bash
./mvnw -f queryeer-backend/pom.xml -pl backend-runner,backend-lib-queryengine-jdbc-foundation,backend-lib-queryengine-sql-parser,backend-plugin-jdbc,backend-plugin-payloadbuilder,backend-plugin-dialect-sqlserver -am -DskipTests=true -DcheckstyleSkip=true install
```

The desktop dev transport normally runs that preparation automatically, then starts the backend directly with `java` using `backend-runner/target/classes` plus `backend-runner/target/queryeer-runner-classpath.txt`.

Run backend runner manually after preparation:

```bash
java -cp "queryeer-backend/backend-runner/target/classes:<contents of queryeer-backend/backend-runner/target/queryeer-runner-classpath.txt>" com.queryeer.backend.runner.BackendRunnerApp
```

Use `;` instead of `:` as the classpath separator on Windows.

## External plugin packaging note

- Runner uses manifest-first discovery (`plugin.json`) from plugin folders and `.zip` sources.
- Backend and frontend targets can be declared under one plugin identity in a single manifest.
- For local dev probe package, staged backend jars should exist in `plugins/dev-query-probe/lib`.
- Builtin backend plugins are real manifest plugins under `plugins/builtin` during development.
- Builtin dev manifests point directly at module `target/classes` and Maven-generated `target/queryeer-plugin-deps.txt` files, so a normal backend Maven build refreshes classes and dependency lists without copying plugin classes.
- Backend plugin ids use the `queryengine.*` namespace, for example `queryengine.jdbc`, `queryengine.payloadbuilder`, and `queryengine.jdbc.dialect.sqlserver`.
- Release packaging should generate a separate production `plugins/builtin` layout under a build output directory. It should not rewrite the repository dev manifests.

## Backend plugin factory injection

- Backend plugins can be loaded through either `backend.entrypointClass` (legacy path) or `backend.factoryClass` (recommended for plugin-local IoC).
- `backend.factoryClass` must implement `com.queryeer.backend.api.BackendPluginFactory` and receives `PluginHostServices` from `backend-api`.
- Only `backend-api` interfaces are passed across the host/plugin classloader boundary.

Example `plugin.json` backend section:

```json
{
  "backend": {
    "factoryClass": "com.example.plugin.ExampleBackendPluginFactory"
  }
}
```

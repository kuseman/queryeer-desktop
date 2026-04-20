# Queryeer Backend

Standalone Java backend reactor for Queryeer Desktop.

## Modules

- `backend-api`: plugin SPI and injected service interfaces
- `backend-contract`: protocol DTOs/envelopes
- `backend-core`: plugin runtime and startup validation
- `backend-transport-stdio`: stdio protocol adapter scaffold
- `backend-runner`: executable bootstrap/wiring
- `backend-plugin-payloadbuilder`: payloadbuilder plugin scaffold
- `backend-plugin-jdbc`: jdbc plugin scaffold
- `backend-plugin-devprobe`: external dev probe backend companion plugin

## Build

From repository root:

```bash
./mvnw -f queryeer-backend/pom.xml clean verify
```

Run backend runner:

```bash
./mvnw -f queryeer-backend/pom.xml -pl backend-runner -am exec:java -Dexec.mainClass=com.queryeer.backend.runner.BackendRunnerApp
```

Run backend runner with external plugins path:

```bash
./mvnw -f queryeer-backend/pom.xml -pl backend-runner -am exec:java -Dexec.mainClass=com.queryeer.backend.runner.BackendRunnerApp -Dqueryeer.plugins.path=plugins
```

## External plugin packaging note

- Runner uses manifest-first discovery (`plugin.json`) from plugin folders and `.zip` sources.
- Backend and frontend targets can be declared under one plugin identity in a single manifest.
- For local dev probe package, staged backend jars should exist in `plugins/dev-query-probe/lib`.

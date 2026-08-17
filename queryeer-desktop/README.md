# Queryeer Desktop

Electron + React + TypeScript desktop shell for Queryeer. In development it starts the Java backend from the repository using the dev backend transport.

## Prerequisites

- Node.js 20+
- Java 25 compatible JDK on `PATH`
- Run `npm install` once in this folder

## Daily Development

```bash
npm run dev
```

The app starts Electron and launches the Java backend when needed. On first backend startup per Electron session, Maven prepares the Java backend and builtin plugin classpaths. The backend process itself is then launched directly with `java`.

Builtin backend plugins are real manifest plugins during development. Their manifests live under repository `plugins/builtin`, point at Java module `target/classes`, and use generated `target/queryeer-plugin-deps.txt` files for dependency jars.

## User Data

Electron's user-data directory is passed to the backend as `QUERYEER_APP_DIR`. Backend runtime files should appear there, including:

- `libNative/`
- `libShared/`
- `jdbc-schema-cache/`

PostgreSQL, SQL Server, and SQLite JDBC drivers can be installed from **Settings > Query Engine > JDBC > JDBC Drivers**. Queryeer stores managed drivers in `libShared/`; activating a driver change restarts only the Java backend.

If a file like `jdbc-schema-cache/` appears in the repository root, that usually means backend app-dir propagation regressed.

## Commands

```bash
npm run typecheck
npm run lint
npm run build
npm run test:integration
npm run dist:dir
```

For backend-only verification, run from the repository root:

```bash
./mvnw -f queryeer-backend/pom.xml clean verify
```

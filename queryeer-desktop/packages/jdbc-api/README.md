# @queryeer/jdbc-api

TypeScript API for Queryeer Desktop plugins that extend its JDBC query engine: dialects and their connection forms, managed drivers, the SQL Databases tree and its actions.

## Installation

```bash
npm install --save-dev @queryeer/jdbc-api @queryeer/api
```

## Usage

```typescript
import type { JdbcDialectContribution, JdbcManagedDriverContribution } from "@queryeer/jdbc-api";
```

The registries are on the plugin's context: `context.jdbcDialects`, `context.jdbcDrivers`, `context.jdbcTreeContextMenu`, `context.jdbcTreeActions`. Declare the JDBC engine (`queryengine.jdbc`) as a dependency in `plugin.json`.

Its versions follow Queryeer Desktop's. Since 0.24 it re-exports these types from `@queryeer/api`, where they still live; import them from this package, and the imports stay the same when they move here.

## License

MIT

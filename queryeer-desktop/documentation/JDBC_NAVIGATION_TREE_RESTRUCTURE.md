# JDBC Navigation Tree Restructure

Status: Planned
Scope: Introduce categorized folder hierarchy, explicit NodeType enum, dialect tree extension API, and decouple tree navigation from H2 cache.

## Motivation

The current tree lists tables and views as flat children under each schema node, with no category groupings, no fully qualified display names, and no way for dialects to introduce unique RDBMS constructs (sequences, users, roles, etc.).

## Key design decisions

1. **FullName** — every OBJECT node carries a `fullName` (e.g. `"dbo.Customers"`) for display and copy.
2. **Explicit NodeType enum** — each node carries its role: `CONTAINER` (virtual grouping), `STRUCTURAL` (RDBMS namespace), `FOLDER` (type category), `OBJECT` (actual DB object), `PROPERTY` (column/constraint/index).
3. **Explicit kind suffixes** — `*_container` for CONTAINER nodes, `*_folder` for FOLDER nodes.
4. **Lazy-loaded folders** — folders are returned with `children: null`; expanding a folder fetches its objects via the backend.
5. **Databases wrapper** — a `databases_container` node sits between `connection` and individual databases, giving dialect top-level branches natural sibling positioning.
6. **Dialect tree branches** — dialects declare additional CONTAINER/FOLDER nodes via `JdbcDialect.treeBranches()`, resolved by the dialect's own `JdbcSchemaResolver`.
7. **Tree navigation is live** — tree expansion always queries the database. No tree snapshot is stored in H2.
8. **H2 cache is completion-only** — the crawl coordinator persists a flat completion index (databases, schemas, tables/views, columns, later FKs). The crawl decay/scoring system stays intact.

## Target tree shape

```
connection (STRUCTURAL)
├── databases_container (CONTAINER)
│   ├── database "AdventureWorks" (STRUCTURAL)
│   │   ├── schemas_container (CONTAINER)       ← only when RDBMS has schemas
│   │   │   ├── schema "dbo" (STRUCTURAL)
│   │   │   │   ├── tables_folder (FOLDER)       … table objects with fullName
│   │   │   │   │   └── table "Customers" (OBJECT)
│   │   │   │   │       ├── columns_folder (FOLDER)
│   │   │   │   │       │   ├── column "CustomerID" (PROPERTY)
│   │   │   │   │       │   └── column "CompanyName" (PROPERTY)
│   │   │   │   │       └── indexes_folder (FOLDER)
│   │   │   │   │           └── index "PK_Customers" (PROPERTY)
│   │   │   │   ├── views_folder (FOLDER)        … view objects with fullName
│   │   │   │   ├── procedures_folder (FOLDER)   … procedure objects with fullName
│   │   │   │   └── sequences_folder (FOLDER)    ← dialect contribution
│   │   │   │       … sequence objects
│   │   │   └── schema "other" (STRUCTURAL)
│   │   └── [schema-less DB: folders at database level]
│   │       ├── tables_folder
│   │       └── views_folder
│   └── database "Northwind" (STRUCTURAL)
│       …
└── security_container (CONTAINER)               ← dialect top-level branch
    ├── users_folder (FOLDER)
    │   ├── user "sa" (OBJECT)
    │   └── …
    └── roles_folder (FOLDER)
        └── …
```
connection (STRUCTURAL)
├── databases_container (CONTAINER)
│   ├── database "AdventureWorks" (STRUCTURAL)
│   │   ├── schemas_container (CONTAINER)       ← only when RDBMS has schemas
│   │   │   ├── schema "dbo" (STRUCTURAL)
│   │   │   │   ├── tables_folder (FOLDER)       … table objects with fullName
│   │   │   │   ├── views_folder (FOLDER)        … view objects with fullName
│   │   │   │   ├── procedures_folder (FOLDER)   … procedure objects with fullName
│   │   │   │   └── sequences_folder (FOLDER)    ← dialect contribution
│   │   │   │       … sequence objects
│   │   │   └── schema "other" (STRUCTURAL)
│   │   └── [schema-less DB: folders at database level]
│   │       ├── tables_folder
│   │       └── views_folder
│   └── database "Northwind" (STRUCTURAL)
│       …
└── security_container (CONTAINER)               ← dialect top-level branch
    ├── users_folder (FOLDER)
    │   ├── user "sa" (OBJECT)
    │   └── …
    └── roles_folder (FOLDER)
        └── …
```

## Contract changes

### JdbcSchemaObject (Java + TS)

```java
public record JdbcSchemaObject(
  String id,
  String name,
  String kind,
  NodeType nodeType,          // NEW
  String fullName,            // NEW — nullable; e.g. "dbo.Customers"
  List<JdbcSchemaObject> children,
  Map<String, Object> attributes
) {}
```

### NodeType enum

```java
public enum NodeType {
    CONTAINER,   // virtual grouping: databases_container, schemas_container, security_container
    STRUCTURAL,  // RDBMS namespace: database, schema
    FOLDER,      // type category: tables_folder, views_folder, procedures_folder, sequences_folder
    OBJECT,      // DB object: table, view, procedure, sequence, user
    PROPERTY     // object component: column, primary_key, foreign_key, index
}
```

### JdbcDialect.treeBranches()

```java
default List<JdbcTreeBranch> treeBranches() { return List.of(); }

record JdbcTreeBranch(
    String parentKind,     // attach under: "connection" or "schema"
    String kind,           // e.g. "security_container", "sequences_folder"
    NodeType nodeType,     // CONTAINER or FOLDER
    String displayName,    // "Security", "Sequences"
    String icon            // frontend icon hint
) {}
```

## Fetch protocol (parentKind dispatch)

The frontend sends the expanded node's `kind` as `parentKind`. The backend routes to the resolver logic based on it:

| Expanded node `kind` | Backend resolves |
|---|---|
| `connection` | `[databases_container]` + dialect `treeBranches(parentKind="connection")` |
| `databases_container` | database names |
| `database` | `[schemas_container]` (if has schemas) or folders directly |
| `schemas_container` | schema names |
| `schema` | `[tables_folder, views_folder, procedures_folder]` + dialect `treeBranches(parentKind="schema")` |
| `tables_folder` | table names with `fullName = schema.table` |
| `views_folder` | view names with `fullName = schema.view` |
| `procedures_folder` | procedure names with `fullName = schema.procedure` |
| `table` / `view` | `[columns_folder, indexes_folder]` |
| `columns_folder` | column objects with type/nullable/PK/FK attributes |
| `indexes_folder` | index objects with columns/unique/primaryKey attributes |
| *dialect custom kinds* | dialect's resolver handles |

## Caching strategy

### Separation of concerns

- **Tree navigation** — always live. Expanding a node queries the database directly. No tree snapshot is stored or merged in H2.
- **Completion index** — persisted in H2 by the crawl coordinator. Used by `JdbcSchemaNavigator` for snappy code completion and symbol resolution.

### What stays in H2

The crawl coordinator persists a flat index optimized for fast lookups:

| H2 table | Columns | Purpose |
|---|---|---|
| `database_index` | `connection_id, database_name` | Quick command, tree init |
| `schema_index` | `connection_id, database_name, schema_name` | Completion scoping |
| `object_index` | `connection_id, database_name, schema_name, object_name, kind` | Table/view completion |
| `object_column` | `connection_id, database_name, schema_name, object_name, column_name, type, nullable, ordinal` | Column completion; future FK-driven join completion |
| `object_index_detail` | `connection_id, database_name, schema_name, object_name, index_name, columns, unique` | Index completion and display |

### Crawl coordinator retains

- Decay/usage scoring (hot/warm/cold/disabled intervals)
- Failure backoff (x2 per consecutive failure, capped)
- Background periodic refresh
- On-demand refresh triggers

### What is removed

- `JdbcSchemaCrawlScope.DEEP`
- Tree snapshot merge/upsert logic in `JdbcSchemaStore` and `JdbcSchemaActionHandler`
- Async persist executor in `JdbcSchemaActionHandler`
- No coupling between tree `fetch()` and H2 writes

## Standard kinds registry

| kind | nodeType | Parent kind | Meaning |
|---|---|---|---|
| `connection` | STRUCTURAL | — | Root node per connection |
| `databases_container` | CONTAINER | connection | Groups database nodes |
| `database` | STRUCTURAL | databases_container | An RDBMS database/catalog |
| `schemas_container` | CONTAINER | database | Groups schema nodes (absent for schema-less DBs) |
| `schema` | STRUCTURAL | schemas_container | An RDBMS schema |
| `tables_folder` | FOLDER | schema / database | Groups table objects |
| `views_folder` | FOLDER | schema / database | Groups view objects |
| `procedures_folder` | FOLDER | schema / database | Groups procedure objects |
| `table` | OBJECT | tables_folder | A table |
| `view` | OBJECT | views_folder | A view |
| `procedure` | OBJECT | procedures_folder | A procedure/function |
| `columns_folder` | FOLDER | table / view | Groups column objects |
| `indexes_folder` | FOLDER | table / view | Groups index objects |
| `column` | PROPERTY | columns_folder | A column |
| `primary_key` | PROPERTY | table / view | Primary key constraint |
| `foreign_key` | PROPERTY | table / view | Foreign key constraint |
| `index` | PROPERTY | indexes_folder | Index |

Dialect-introduced kinds use `*_container` / `*_folder` / plain naming as appropriate.

## Files changed

### Contract (TypeScript)

| File | Change |
|---|---|
| `src/plugins/core.queryengine.jdbc/jdbc-navigation-types.ts` | Add `fullName?: string`, `NodeType` enum to `JdbcSchemaObject` |

### Contract (Java foundation lib)

| File | Change |
|---|---|
| `JdbcSchemaObject.java` | Add `NodeType nodeType`, `String fullName` |
| (new) `NodeType.java` | Enum in `backend-lib-queryengine-jdbc-foundation` |
| (new) `JdbcTreeBranch.java` | Record in `backend-lib-queryengine-jdbc-foundation` |
| `JdbcSchemaResolver.java` | Document `parentKind` option contract |

### Backend (plugin + dialect)

| File | Change |
|---|---|
| `JdbcDialect.java` | Add `List<JdbcTreeBranch> treeBranches()` |
| `InformationSchemaJdbcSchemaResolver.java` | Rewrite: parentKind dispatch, folder output, procedures |
| `JdbcSchemaActionHandler.java` | Route by parentKind; merge dialect branches; remove deep persist |
| `JdbcSchemaStore.java` | Replace tree snapshots with index tables |
| `JdbcSchemaCrawler.java` | Strip to index-only population |
| `JdbcSchemaCrawlCoordinator.java` | Keep decay/scoring; target completion index only |
| `JdbcSchemaCrawlPolicy.java` | Unchanged (decay logic reused) |
| `JdbcSchemaCrawlScope.java` | Remove DEEP |
| `JdbcSchemaNavigator.java` | Query index tables for completion/symbols |
| `BasicJdbcDialect.java` | (no change unless overriding treeBranches) |
| `SqlServerSchemaResolver.java` | Adapt to parentKind dispatch + folder structure |
| `SqlServerDialect.java` | Add `treeBranches()` example (Security→Users) |

### Frontend

| File | Change |
|---|---|
| `jdbc-navigation-store.ts` | `fetchChildren()` sends `parentKind`; `materializeNodes()` switches on `NodeType`; create `databases_container` on connection expand |
| `JdbcNavigationTree.tsx` | `formatNodeLabel()` uses `fullName` for OBJECT nodes |
| `jdbc-tree-contribution.ts` | Default icons for all standard kinds (containers, folders, objects) |
| `jdbc-navigation.css` | Container/folder visual styling |

### Documentation

| File | Change |
|---|---|
| `documentation/BACKEND_PROTOCOL.md` | Document new tree structure, fetch protocol, and treeBranches API |

## Execution phases

1. **Contract types** — `NodeType`, `JdbcTreeBranch`, `JdbcSchemaObject` update (Java + TS)
2. **InformationSchemaJdbcSchemaResolver rewrite** — parentKind dispatch, folder output, procedure support
3. **JdbcDialect.treeBranches()** — interface + action handler merge logic
4. **Caching refactor** — strip tree snapshots from store, slim to index tables, keep crawl decay
5. **Frontend** — store, tree rendering, tree contributions
6. **Consumer adaptations** — navigator, database cache, session store
7. **SQL Server dialect** — folder structure + Security→Users example
8. **Tests** — unit + integration throughout
9. **BACKEND_PROTOCOL.md** — document all changes

# backend-lib-queryengine-jdbc-foundation

Shared JDBC query-engine foundation abstractions.

This module is intentionally runtime-agnostic and provides:

- Dialect registry and metadata contracts.
- Rich connection setup metadata for UI composition.
- Dialect-specific query execution and schema resolving interfaces.

Planned consumers:

- `backend-plugin-jdbc` for execution and connection capability exposure.
- `backend-plugin-queryengine-payloadbuilder-jdbc` for JDBC catalog bridge features.

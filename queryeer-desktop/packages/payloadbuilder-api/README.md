# @queryeer/payloadbuilder-api

TypeScript API for Queryeer Desktop plugins that extend its payloadbuilder query engine: catalogs and their settings panels.

## Installation

```bash
npm install --save-dev @queryeer/payloadbuilder-api @queryeer/api
```

## Usage

```typescript
import type { PayloadbuilderCatalogContribution } from "@queryeer/payloadbuilder-api";
```

The registry is on the plugin's context: `context.payloadbuilderCatalog`. Declare the payloadbuilder engine (`queryengine.payloadbuilder`) as a dependency in `plugin.json`, optional when the plugin also works without it.

Its versions follow Queryeer Desktop's. Since 0.24 it re-exports these types from `@queryeer/api`, where they still live; import them from this package, and the imports stay the same when they move here.

## License

MIT

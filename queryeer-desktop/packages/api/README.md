# @queryeer/api

TypeScript API contracts and types for building Queryeer extensions. This package provides the core interfaces, contracts, and type definitions that extension authors use to integrate with the Queryeer desktop application.

## Installation

```bash
npm install @queryeer/api
```

## Usage

```typescript
import { CommandExtension } from '@queryeer/api';
import { BackendGateway } from '@queryeer/api/backend';
```

## Sub-path exports

| Export path | Description |
|-------------|-------------|
| `@queryeer/api` | Core extension contracts (commands, files, shell, workspace) |
| `@queryeer/api/backend` | Backend gateway and IPC contracts |

## License

MIT

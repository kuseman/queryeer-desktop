# Queryeer Desktop

[![Desktop CI](https://github.com/kuseman/queryeer-desktop/actions/workflows/queryeer-desktop-ci.yml/badge.svg)](https://github.com/kuseman/queryeer-desktop/actions/workflows/queryeer-desktop-ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Monorepo containing the Queryeer Desktop shell and Java backend reactor.

## Current Status

| Check | Status |
|-------|--------|
| Desktop Build | ![Build](https://img.shields.io/badge/build-passing-brightgreen) |
| Desktop Tests | ![Tests](https://img.shields.io/badge/tests-passing-brightgreen) |
| Backend Verify | ![Backend](https://img.shields.io/badge/backend-verified-brightgreen) |

## Repositories

| Module | Description |
|--------|-------------|
| `queryeer-desktop/` | Electron + React + TypeScript desktop shell |
| `queryeer-backend/` | Java backend reactor |
| `plugins/dev-query-probe/` | Developer query probe plugin |

## Development

### Desktop

```bash
cd queryeer-desktop
npm install
npm run dev
```

### Backend

```bash
cd queryeer-backend
./mvnw -f pom.xml clean verify
```

## Documentation

- [Architecture Decision Records](queryeer-desktop/documentation/)
- [Backend Protocol](queryeer-desktop/documentation/BACKEND_PROTOCOL.md)
- [Migration Plan](queryeer-desktop/MIGRATION_PLAN.md)
- [Session Handoff](queryeer-desktop/SESSION_HANDOFF.md)

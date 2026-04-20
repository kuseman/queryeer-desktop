# Queryeer Desktop (Increment 1)

This folder is the first incremental step in migrating Queryeer toward an Electron frontend with a Java backend.

Current scope:

- Electron + React + TypeScript scaffold
- secure process split (`main` / `preload` / `renderer`)
- linting and type-check scripts
- build + packaging scripts (`electron-builder`)
- minimal, runnable shell UI

Out of scope in this increment:

- Java backend integration
- plugin runtime and module loading
- editor/query/output modules

## Prerequisites

- Node.js 20+

## Commands

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm run build
npm run dist:dir
```

## Suggested next increments

1. Establish plugin contracts and lifecycle for shell modules (filesystem/layout/panels).
2. Add IPC contract definitions and a backend process adapter boundary.
3. Introduce a minimal module host that can load one internal renderer plugin.

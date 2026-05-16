# AGENTS.md

This repository contains two active migration workstreams:

- `queryeer-desktop` (Electron + React + TypeScript frontend shell)
- `queryeer-backend` (standalone Java backend reactor)

## Mandatory update rule for every AI session

If contract shapes are changed, the agent MUST update both sides in the same session:

- TypeScript contracts: `queryeer-desktop/src/contracts/backend/*`
- Java contracts: `queryeer-backend/backend-contract/*`

and then update:

- `queryeer-desktop/documentation/BACKEND_PROTOCOL.md`

## Validation expectation per session

When applicable, run and report:

- Desktop: `npm run typecheck && npm run lint && npm run build && npm run test:integration` (from `queryeer-desktop`)
- Backend: `./mvnw -f queryeer-backend/pom.xml -DskipTests=true clean verify`

## Test-first expectation

- Prefer adding or extending tests for every non-trivial code change.
- Minimum bar for behavior changes: add/adjust focused unit tests in the same session.
- If a change crosses module/runtime boundaries (contracts, persistence, IPC, editor/workspace flow), add at least one higher-level integration-style test when feasible.

## Java code style directives

- Prefer package-private visibility by default in Java.
- Add `public` only when a type/member must be accessed across package boundaries (API/contracts/composition roots).

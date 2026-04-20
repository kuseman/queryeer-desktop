# AGENTS.md

This repository contains two active migration workstreams:

- `queryeer-desktop` (Electron + React + TypeScript frontend shell)
- `queryeer-backend` (standalone Java backend reactor)

## Mandatory update rule for every AI session

Before ending a session that changes architecture, contracts, runtime behavior, or project structure, the agent MUST update the following files:

1. `queryeer-desktop/SESSION_HANDOFF.md`
   - update "Current snapshot"
   - update "What changed in this session"
   - update "Next 3 tasks"
   - update "Known gaps / temporary scaffolds"
2. `queryeer-desktop/MIGRATION_PLAN.md`
   - reflect completed or newly started increments
   - keep backend planning artifacts current
3. `queryeer-backend/ROADMAP.md`
   - check/uncheck progress items per module
   - record newly introduced blockers or decisions

If contract shapes are changed, the agent MUST update both sides in the same session:

- TypeScript contracts: `queryeer-desktop/src/contracts/backend/*`
- Java contracts: `queryeer-backend/backend-contract/*`

and then update:

- `queryeer-desktop/documentation/BACKEND_PROTOCOL.md`

## Validation expectation per session

When applicable, run and report:

- Desktop: `npm run typecheck && npm run lint && npm run build` (from `queryeer-desktop`)
- Backend: `./mvnw -f queryeer-backend/pom.xml -DskipTests=true clean verify`

## Handoff quality bar

Handoff must be sufficient for a brand new agent session to continue without reading tool logs.

## Java code style directives

- Prefer package-private visibility by default in Java.
- Add `public` only when a type/member must be accessed across package boundaries (API/contracts/composition roots).

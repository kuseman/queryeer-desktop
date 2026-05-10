# Core Security Implementation Plan

Status: active implementation plan with resumable phases.

## Phase 0 - Legacy Cleanup and Boundary Reset

- [x] Remove legacy credential RPC from frontend/backend contracts.
- [x] Remove legacy credential request handler and capability wiring from Java transport.
- [x] Remove legacy credential protocol fixtures and related checks.
- [x] Update protocol and architecture docs to remove legacy credential RPC references.

## Phase 1 - Core Security Module Skeleton

- [x] Add `core.security` plugin manifest/module wiring.
- [x] Add module-owned settings for:
  - [x] unlock policy (`startup` vs `first-use`)
  - [x] master password storage policy (`ask` vs `safeStorage`)
- [x] Add typed shell bridge operations for security use cases.

## Phase 2 - Vault Domain + Persistence

- [x] Add vault document model (`version`, metadata salt, entries).
- [x] Add AES-GCM envelope format (`iv`, `authTag`, `ciphertext`).
- [x] Add scrypt-based key derivation service.
- [x] Add atomic vault persistence (`vault.json.tmp` -> `vault.json`).
- [x] Add broken-file quarantine behavior for unreadable vault JSON.

## Phase 3 - Session and Unlock Flow

- [x] Add main-process security session service.
- [x] Cache derived master key in memory when unlocked.
- [x] Support explicit lock/unlock operations.
- [x] Support lazy unlock semantics via policy setting.

## Phase 4 - Master Password Persistence Option

- [x] Add optional persisted master password using Electron `safeStorage`.
- [x] Keep default policy as prompt-only (`ask`).
- [x] Keep policy decision independent from vault cryptography.

## Phase 5 - Rotation and Secret Lifecycle APIs

- [x] Add `storeSecret` API returning stable secret refs.
- [x] Add `resolveSecret` API for ref-based retrieval.
- [x] Add `deleteSecret` API.
- [x] Add `rotateMasterPassword` API with full re-encrypt flow.

## Phase 6 - Tests and Validation

- [x] Add focused unit tests for crypto/key derivation behaviors.
- [x] Add focused unit tests for vault persistence and atomic writes.
- [ ] Add integration-style test covering unlock -> store -> resolve -> rotate.
- [ ] Run full desktop/backend validation suite and address failures.

## Phase 7 - Next Session (Planned)

- [ ] Define explicit Java secret communication boundary after `core.security` baseline is merged.
- [ ] Decide whether secret refs remain desktop-local or are mapped to backend-side handles.
- [ ] Add cross-process protocol methods only after boundary decision.

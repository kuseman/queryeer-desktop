# Security Backend Migration Plan

Status: active

## Goal

Move secret-ref resolution from Electron-side payload materialization to Java backend-side resolution, while keeping desktop as owner of vault lifecycle and unlock policy.

## Direction

- Desktop (Electron main) continues to:
  - own vault file writes (`vault.json`)
  - own unlock/lock UX and policy
  - derive session key from master password
- Java backend gets:
  - control-plane `security.*` methods for session lifecycle
  - vault metadata change notifications
  - credential resolver that decrypts refs on demand

## Phase 1 (started)

- Add protocol methods/capabilities:
  - `security.session.open`
  - `security.session.close`
  - `security.vault.changed`
- Add Java stdio handlers with safe no-op acknowledgements and in-memory bridge state.
- Wire desktop `SecurityService` hooks to send control requests when:
  - unlock succeeds
  - lock occurs
  - vault entries change
  - master password rotates

## Phase 2 (done)

- Introduce structural secret wrapper payload format:
  - `{ "secretRef": "uuid" }`
- Add Java resolver service:
  - parse/decrypt `vault.json`
  - cache by file timestamp + session state
  - invalidate on `security.vault.changed` and `security.session.close`

## Phase 3 (in progress)

- Remove desktop-side secret materialization in `BackendGateway`. (done)
- Require backend security capabilities during handshake (`security.session.open`, `security.session.close`, `security.vault.changed`). (done)
- Add integration coverage for:
  - unlock + execute
  - lock + blocked execute
  - rotate + subsequent execute
  - vault edits + cache invalidation

## Security constraints

- Never send raw master password to Java.
- `security.session.open` carries derived session key only.
- `security.*` handlers must avoid logging sensitive values.
- In-memory key/cache must be cleared on session close and process shutdown.

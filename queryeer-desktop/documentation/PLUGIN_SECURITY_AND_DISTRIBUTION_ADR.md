# ADR: External Plugin Security, Installation UX, and Repository Distribution

**Status:** Proposed  
**Date:** 2026-05-31  
**Deciders:** @marhen105

---

## Context

Queryeer now supports loading external plugins. The next step is to make this safe and manageable for real users.

Current gaps:

1. No first-class UI to install, disable, update, or remove plugins.
2. No clear trust model for plugin integrity and publisher identity.
3. No managed update mechanism beyond manual replacement.
4. No persistent lock/audit file to explain exactly what was installed.
5. External plugin discovery must be product-default behavior, not controlled by a plugin path environment variable.

We want to support two distribution paths:

1. Manual install from local `.zip` (or file upload in UI).
2. Plugin repositories that expose a manifest index with versions and metadata.

---

## Decision

Adopt a **single security model** that applies to both installation paths, and roll out in phases:

1. **Phase 1:** Plugin Manager UI + secure local ZIP install + lockfile + crash-safe operations.
2. **Phase 2:** Repository support (`plugins-manifest.json`) + update discovery and install.
3. **Phase 3:** Mandatory publisher signatures (or strict policy mode), richer permissions, and enterprise controls.

Manual ZIP install remains supported permanently. Repository support is additive.

Additional runtime decisions:

1. Builtin plugins are platform components. They are always loaded, never shown in the Plugin Manager, and never user-disableable.
2. External plugins are installed per user under Queryeer's managed app-data `plugins` directory.
3. The product has one normal discovery behavior: builtin plugins plus enabled per-user external plugins.
4. Safe mode skips external plugin activation while keeping builtin plugins active.
5. Initial update/remove support may require restart; hot lifecycle support is incremental.

---

## Core Principles

1. **Same validation for every source** (manual or repository).
2. **Integrity first** (hash verification), then **authenticity** (signatures).
3. **Least surprise UX** (explicit permissions, explicit source, explicit updates).
4. **Recoverability** (safe mode, auto-disable on repeated crashes, rollback on failed install).
5. **Auditable state** via lockfile and install history.

---

## Phase 1 Scope (MVP Hardening)

### 1) Plugin Manager UI

Add a dedicated UI surface for:

- Installed plugins (id, version, source, status).
- Enable/disable toggle.
- Uninstall.
- Install from local ZIP.
- Diagnostics (last load error, crash loop disabled reason).

### 2) Managed installation flow

Install pipeline for ZIP:

1. Read archive.
2. Validate `plugin.json` schema and compatibility.
3. Validate dependency graph and ID collisions.
4. Compute SHA-256 of archive and unpacked main assets.
5. Stage into temp directory, then atomic move into managed plugins directory.
6. Persist lockfile entry.

### 3) Lockfile

Introduce `plugins-lock.json` under Queryeer user data.

Draft shape:

```json
{
  "version": 1,
  "plugins": [
    {
      "id": "example.hello-world",
      "version": "0.1.0",
      "enabled": true,
      "source": {
        "type": "local-zip",
        "path": "C:/Users/me/Downloads/hello-world.zip"
      },
      "integrity": {
        "algorithm": "sha256",
        "archiveHash": "...",
        "installedAt": "2026-05-31T20:00:00.000Z"
      },
      "signing": {
        "verified": false,
        "fingerprint": null
      }
    }
  ]
}
```

### 4) Runtime safety

- Safe mode launch option that skips external plugin activation.
- Crash loop threshold (example: 3 failed starts due to same plugin) triggers auto-disable.
- Clear notification and diagnostic log entry on auto-disable.

---

## Phase 2 Scope (Repository Distribution)

Support adding one or more repository URLs.

Repository index contract (`plugins-manifest.json`) draft:

```json
{
  "schemaVersion": 1,
  "name": "Queryeer Official",
  "baseUrl": "https://plugins.example.com/",
  "generatedAt": "2026-05-31T19:30:00.000Z",
  "plugins": [
    {
      "id": "com.example.csv-exporter",
      "name": "CSV Exporter",
      "latestVersion": "1.2.0",
      "versions": [
        {
          "version": "1.2.0",
          "minQueryeerVersion": "0.10.0",
          "downloadUrl": "plugins/com.example.csv-exporter/1.2.0.zip",
          "sha256": "...",
          "changelogUrl": "plugins/com.example.csv-exporter/CHANGELOG.md",
          "signature": "..."
        }
      ]
    }
  ],
  "signature": "..."
}
```

Repository behavior:

- Periodic refresh (manual + background).
- Show available updates in UI.
- Install/update uses same validation pipeline as local ZIP.
- Lockfile records repository URL and resolved artifact hash.

---

## Security Model

### Integrity

- Required: SHA-256 for every install artifact.
- Verify before unpack and after write (optional second pass in strict mode).
- Hash material must come from a trust boundary outside the plugin archive:
  - Repository installs: expected SHA-256 is read from repository metadata (`plugins-manifest.json`).
  - Manual ZIP installs: first install computes SHA-256 and pins it in `plugins-lock.json`; subsequent loads/reinstalls must match.
- A hash bundled only inside the same plugin ZIP is not treated as a trust source (it can be modified together with the payload).

### Authenticity

- Phase 1: optional signature verification with warning on unsigned plugin.
- Phase 3 target: configurable policy:
  - `allowUnsigned` (dev default)
  - `warnUnsigned` (recommended default)
  - `requireSigned` (enterprise/strict)

### Permissions (coarse-grained first)

Add optional manifest permission declarations and consent prompt for sensitive scopes:

- `filesystem`
- `network`
- `clipboard`
- `backendBridge`
- `queryExecution`
- `secretsAccess`

Policy: if permissions increase on update, require explicit re-consent.

---

## UI/UX Decision Notes

1. Keep manual ZIP install for power users and internal environments.
2. Repository experience should feel app-store-like, but with explicit trust signals:
   - source label,
   - signer label/fingerprint,
   - hash-verified indicator,
   - permissions summary.
3. No silent privilege elevation during updates.

---

## Operational and Enterprise Considerations

- Allow-list of approved repository domains.
- Optional policy file to block unapproved plugin IDs.
- Export diagnostics bundle (installed plugins, lockfile, load errors).
- Admin setting to disable local ZIP install.

---

## Consequences

### Positive

1. Safer plugin ecosystem with clearer trust boundaries.
2. Better user support due to explicit plugin state and diagnostics.
3. Foundation for official plugin catalog and auto-update workflows.

### Negative

1. Additional implementation complexity (UI + policies + signature handling).
2. Slightly longer install flow due to validation and hashing.
3. Backward compatibility overhead for legacy unsigned plugins.

---

## Alternatives Considered

### A) Manual ZIP only, no repository

Rejected as sole strategy. Too limited for update discovery and mainstream plugin UX.

### B) Repository only, no manual ZIP

Rejected. Manual installation is needed for local development, offline use, and private plugins.

### C) Hash checks only, no signatures

Partially accepted for early phase, but insufficient long-term for publisher authenticity.

---

## Rollout Plan

1. Implement Phase 1 (UI + lockfile + safe install/uninstall + crash-loop auto-disable).
2. Implement Phase 2 (repository index support + update notifications).
3. Implement signature policy modes and permission re-consent on updates.
4. Publish migration guide for plugin authors (signing, permissions, repository metadata).

---

## Open Questions

1. Signature format choice (minisign, cosign, custom Ed25519 envelope).
2. Canonicalization rules for signed repository manifests.
3. Exact default policy for unsigned plugins in stable releases.
4. Whether backend plugins need stronger isolation boundary in a later ADR.

# Security Guide (Vault & Secret Fields)

This guide explains how secure values (passwords, tokens, API keys) work in Queryeer Desktop.

## What is stored

- Secure fields are stored as **secret references** (for example `...Ref`) in settings.
- Plain secret text is stored in the local encrypted **vault**.
- The backend receives concrete secret values only at execution time, after secure materialization in Electron main.

## First time setup

1. Open any setting with a secure password field.
2. If vault is locked, the field shows `Vault locked`.
3. Click `Unlock`.
4. Enter your master password in the unlock dialog.

If no vault exists yet, the first unlock creates it.

## Unlock modes

Configured in `Security > Vault`:

- `On First Use`: unlock when a secure action needs the vault.
- `On Startup`: app tries to unlock during startup.

## Master password storage modes

Configured in `Security > Vault`:

- `Ask Every Time`: master password is not persisted.
- `Use OS Secure Storage`: master password is encrypted with Electron `safeStorage` and persisted for startup unlock.

## Daily behavior

- When unlocked, editing secure fields auto-saves to vault.
- Settings store only references, not plaintext secret values.
- Runtime operations that include secret refs will request unlock (when needed) before sending to backend.

## If unlock fails

- Wrong master password: shown as `Invalid master password`.
- Canceled prompt: operation remains locked and no secret is stored/sent.

## Security notes

- Do not share your master password.
- Losing your master password means stored secrets cannot be decrypted.
- Rotate master password periodically if required by policy.

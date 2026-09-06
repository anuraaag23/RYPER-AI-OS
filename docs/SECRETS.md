# Secrets Management

RYPER never hardcodes a secret in source, a config file committed to git, or
a built application bundle. This document is the single source of truth for
where a secret comes from in each environment.

## Local development

- Copy `.env.example` to `.env` (git-ignored).
- `.env` is read only by local dev tooling (test harness, dev server) — it
  is never read by production builds.

## Desktop shells

- Secrets (cloud API keys, sync credentials) are stored via each OS's native
  secure storage, accessed only through `core/security`'s `CapabilityBroker`:
  - Windows: DPAPI / Credential Manager
  - macOS: Keychain Services
  - Linux: Secret Service API (libsecret)
- No secret is ever written to the SQLite database in plaintext; the
  database itself is encrypted at rest (SQLCipher), but credentials
  specifically live in the OS secret store, not application storage.

## Mobile shells

- Android: Android Keystore-backed `EncryptedSharedPreferences`.
- iOS: Keychain Services.

## CI/CD (GitHub Actions)

- Secrets are stored in GitHub's encrypted repository/organization secrets
  and injected as environment variables only for the steps that need them
  (see `.github/workflows/ci.yml` and `release.yml`).
- CI never prints a secret to logs; workflows that must use one wrap the
  step with `::add-mask::` and avoid `set -x`/`echo $SECRET` patterns.

## Cloud sync relay

- The relay is designed to be zero-knowledge: it stores only end-to-end
  encrypted blobs. The encryption key is derived on-device and never
  transmitted to the relay in any form.

## Rotation

- Any credential checked into git history by mistake is treated as
  compromised: rotate it immediately at the provider, then scrub history.
- Cloud API keys are scoped per-deployment (dev/staging/prod use separate
  keys) so a leak in one environment doesn't expose the others.

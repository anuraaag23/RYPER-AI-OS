# Secrets & Credential Management

This document details how credentials, configuration, and sensitive settings are handled in **RYPER AI OS**.

---

## Current Desktop Implementation (v0.1.1)

In the current **v0.1.1** Windows desktop release:

- **Local-Only Operation (Default):** In default local mode, RYPER uses the embedded `llama.cpp` runtime on `127.0.0.1:8080`. No cloud API keys, secrets, or remote authentication tokens are required or used.
- **Settings Storage:** Application configuration (theme, audio devices, local model paths, and any optionally configured cloud provider keys) is stored in standard JSON format at:
  ```text
  %APPDATA%\ryper-ai-os\settings.json
  ```
- **Plaintext Disclosure:** In v0.1.1, settings in `settings.json` are stored in **plaintext JSON format**. While the file is restricted to the local Windows user profile directory, it is **not** currently encrypted using Windows DPAPI or Credential Manager. Users should not store high-value corporate API keys on shared or unencrypted workstations.
- **Hardcoded Secrets:** RYPER's source code contains **zero hardcoded API keys, tokens, or credentials**. Automated pre-commit scans enforce this invariant across all packages.

---

## Planned Target Architecture (v0.2.0+)

The following security enhancements are planned for upcoming releases:

- **Windows:** Migrate cloud API key storage to the Windows Credential Manager or Windows Data Protection API (DPAPI via `node-keytar` or native Windows API bindings).
- **macOS / Linux:** Keychain Services on macOS; Secret Service API (`libsecret`) on Linux desktop.
- **Local Database Encryption:** If persistent conversation history is stored in SQLite in future releases, SQLCipher / SQLite encryption at rest will be introduced.

---

## Developer Guidelines

1. **Never commit secrets:** Never commit `.env`, credentials, tokens, or private keys to git.
2. **Use .env.example:** Any environment variables required for local testing must be documented with placeholder values in `.env.example`.
3. **Automated Audits:** All CI and maintenance workflows run secret scanners to detect inadvertent credential leaks.
4. **Immediate Rotation:** Any credential accidentally pushed to a public or private branch must be considered compromised and rotated immediately at the upstream provider.

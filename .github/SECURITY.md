# Security Policy

The RYPER AI OS team takes security and user privacy seriously. We appreciate the responsible disclosure of vulnerabilities by security researchers and the open-source community.

---

## Supported Versions

Only the latest official release receives active security patches.

| Version | Supported | Platform |
| :--- | :---: | :--- |
| **v0.1.1** | ✅ Yes | Windows 10/11 x64 |
| < v0.1.1 | ❌ No | Deprecated / Frozen baseline |

---

## Reporting a Vulnerability

> [!IMPORTANT]
> **Please do NOT report security vulnerabilities via public GitHub issues, discussions, or pull requests.**

To report a vulnerability responsibly:

1. **GitHub Private Vulnerability Reporting (Preferred):**  
   Navigate to the [Security Advisories tab](https://github.com/anuraaag23/RYPER-AI-OS/security/advisories/new) and submit a private security advisory report.
2. **What to Include:**
   - Detailed description of the vulnerability and its potential impact.
   - Clear, step-by-step instructions or a proof-of-concept (PoC) to reproduce the issue.
   - The specific component affected (e.g. CapabilityBroker, IPC bridge, Local Server Manager, Installer).
   - Operating system version and environment details.
   - Any suggested mitigations or patches.

### Responsible Disclosure Timeline
- We will acknowledge receipt of your vulnerability report within **48 hours**.
- We will provide a status update and estimated remediation timeline within **7 business days**.
- Once a fix is validated, a patched release will be published along with a responsible security advisory crediting your contribution (unless you prefer anonymity).

---

## Current Security Disclosures & Known Limitations

Please note the following documented architectural properties of v0.1.1 before submitting reports:

1. **Unsigned Windows Installer:** The v0.1.1 executable is not Authenticode code-signed, causing Windows SmartScreen to show an "Unknown Publisher" prompt. This is a known distribution status, not an exploitable vulnerability.
2. **Plaintext Settings File:** Application configuration in `%APPDATA%\ryper-ai-os\settings.json` is stored in plaintext JSON within the user's OS profile. Encrypted credential storage (DPAPI) is scheduled for v0.2.0.
3. **Localhost HTTP Binding:** The embedded `llama.cpp` inference server listens on `127.0.0.1:8080`. It is bound strictly to the loopback adapter and is not exposed to the local network or public internet.
4. **In-Process Plugins:** Third-party plugins currently share process memory with the core application. Process-isolated sandboxing is planned for a future milestone.

---

## Guidelines for Issues and Discussions

- **Never share secrets:** Do not post API keys, passwords, authentication tokens, or personally identifiable information (PII) in public issues.
- **Use Sanitized Diagnostics:** When attaching application logs or diagnostic outputs to GitHub issues, use the built-in **"Copy Diagnostics"** button in **Settings > Diagnostics**, which automatically strips usernames, computer names, and local folder paths.

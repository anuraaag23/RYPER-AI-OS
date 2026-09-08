# RYPER AI OS

> **Privacy-first, offline-capable AI desktop assistant for Windows that combines local AI inference with controlled Windows system actions, voice interaction, diagnostics, and a secure permission model.**

[![CI](https://github.com/anuraaag23/RYPER-AI-OS/actions/workflows/ci.yml/badge.svg)](https://github.com/anuraaag23/RYPER-AI-OS/actions/workflows/ci.yml)
[![Release](https://img.shields.io/badge/release-v0.1.1-blue.svg)](https://github.com/anuraaag23/RYPER-AI-OS/releases/tag/v0.1.1)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011%20x64-0078D6.svg)](https://github.com/anuraaag23/RYPER-AI-OS/releases/tag/v0.1.1)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Local AI Engine](https://img.shields.io/badge/local%20AI-llama.cpp-orange.svg)](https://github.com/ggerganov/llama.cpp)

---

## What is RYPER AI OS?

**RYPER AI OS** is a private, on-device AI desktop assistant built specifically for Windows. Unlike cloud-only assistants that route your queries, files, and voice recordings through external servers, RYPER is designed to execute large language model inference and speech processing **locally on your own PC**.

RYPER bridges local intelligence with your desktop environment:
- **Local AI Brain:** Runs quantized GGUF language models directly on your hardware via an embedded `llama.cpp` server on `127.0.0.1`.
- **System Action Engine:** Automates Windows tasks—launching applications, controlling media/volume, querying system health, managing processes, and organizing files.
- **Permission & Security Model:** Every mutating or sensitive operating system action is guarded by an internal Capability Broker and requires explicit user confirmation before execution.
- **Private Voice Pipeline:** Includes push-to-talk speech recognition (`whisper.cpp`) and offline text-to-speech (`Piper`) supporting English, Hindi, and Hinglish.

### Privacy Reality & Scope
We believe in absolute transparency about what "privacy-first" means in practice:
- **Local Mode:** In standard local mode, your prompts, context, and completions never leave your computer.
- **Configurable Cloud Providers:** If you explicitly choose to configure external cloud API keys (e.g. OpenAI, Anthropic, OpenRouter), queries will route to those providers over HTTPS as instructed.
- **External Web Actions:** Asking RYPER to open websites or launch web searches will open your default browser and create expected external network requests.
- **Telemetry:** In the current implementation, application telemetry is strictly disabled by default. No background analytics or prompt logs are sent to remote servers.

---

## Current Release: v0.1.1 (Windows x64)

The current official release of RYPER AI OS is **v0.1.1** for **Windows 10/11 (64-bit)**.

- **Release Date:** September 8, 2026
- **Release Package:** `RYPER.AI.OS.Setup.0.1.1.exe`
- **Release Commit:** `22f919e9113f0cd1c4373df9557eee707c96d3d1`
- **Release Tag:** [`v0.1.1`](https://github.com/anuraaag23/RYPER-AI-OS/releases/tag/v0.1.1)

---

## Download

Download the official Windows installer directly from the GitHub Release page:

📥 **[Download RYPER AI OS v0.1.1 Setup (64-bit)](https://github.com/anuraaag23/RYPER-AI-OS/releases/download/v0.1.1/RYPER.AI.OS.Setup.0.1.1.exe)**

> [!NOTE]
> **Windows SmartScreen Notice:**
> The v0.1.1 installer executable is currently unsigned (Authenticode code-signing certificate is planned for v0.2.0).
> When installing, Windows SmartScreen may show an **"Unknown Publisher"** or **"Windows protected your PC"** dialog.
> To proceed: click **"More info"**, verify the SHA-256 checksum below, and click **"Run anyway"**.

---

## Verify the Download

Always verify the integrity of downloaded binaries before installation.

- **Expected SHA-256 Checksum:**
  ```text
  BAFB215CAF0763F5FCDCDB9DD01E750FEB08BF0C50054610E10131B988F61267
  ```

Verify using Windows PowerShell:
```powershell
Get-FileHash ".\RYPER.AI.OS.Setup.0.1.1.exe" -Algorithm SHA256
```

The computed hash output must match `BAFB215CAF0763F5FCDCDB9DD01E750FEB08BF0C50054610E10131B988F61267` byte-for-byte.

---

## System Requirements

### Minimum Requirements
- **Operating System:** Windows 10 (64-bit, version 1909+) or Windows 11
- **Processor:** x86_64 CPU with AVX2 instruction support (Intel Core 4th Gen+ or AMD Ryzen)
- **Memory (RAM):** 8 GB minimum (4 GB free during operation)
- **Disk Space:** 4 GB available storage (for Electron application runtime and default quantized model weights)
- **Audio:** Microphone and speakers/headphones (for voice speech-to-text and text-to-speech)

### Recommended Configuration
- **Processor:** 8-core modern CPU (Intel Core i7/i9 or AMD Ryzen 7/9)
- **Memory (RAM):** 16 GB or higher
- **GPU / VRAM:** Dedicated NVIDIA GPU with 4 GB+ VRAM (CUDA acceleration enabled in `llama.cpp`)
- **Storage:** NVMe SSD for fast model loading into memory

> [!IMPORTANT]
> **GPU / Hardware Offload Notice:**
> Without a dedicated GPU, inference runs entirely on the host CPU. While fully functional, response generation and initial tool-prompt processing will take noticeably longer than on GPU-accelerated hardware.

---

## Local AI Architecture

RYPER AI OS embeds a dedicated local runtime manager that orchestrates local inference without cloud dependencies:

- **Inference Server:** Embedded `llama.cpp` HTTP server bound strictly to `127.0.0.1:8080`.
- **Default Model:** Qwen 2.5 1.5B Instruct quantized to GGUF format (`q4_k_m`), offering high reasoning density in ~1.1 GB of RAM/VRAM.
- **Status Indicator:** The top navigation bar displays live runtime health:
  - 🟢 **Ready:** Local model is loaded in memory and accepting queries.
  - 🟡 **Downloading / Provisioning:** Model weights are being fetched or extracted.
  - 🔴 **Error / Offline:** Server stopped or port conflict; recovery controls available.

### Cold-Start Latency Disclosure
On systems with limited VRAM or when running in CPU-hybrid mode, the **first tool-enabled conversation turn** can take approximately **70–120 seconds**. This is caused by initial context prefill of the comprehensive system prompt and JSON tool schemas. Once cached, subsequent turns in the same session respond substantially faster.

---

## Controlled Windows Automation

RYPER connects LLM reasoning with native Windows operating system capabilities:

- **Application Control:** Launch, switch, and close desktop applications.
- **Media & Audio:** Adjust system master volume, mute/unmute, play/pause active media.
- **Window Management:** Minimize, maximize, restore, or tile active windows.
- **System Diagnostics:** Inspect CPU load, memory utilization, battery status, and network connectivity.
- **Process Management:** View running processes and safely terminate unresponsive tasks.
- **Filesystem Operations:** Search user folders, create notes, and organize files within user profile bounds.

### Security Broker & Confirmation Dialogs
RYPER does **not** give arbitrary shell access to the language model. Every action request passes through the **Capability Broker**:
- **Read-only actions** (e.g. reading system uptime or querying battery level) execute automatically.
- **Mutating or sensitive actions** (e.g. terminating a process, adjusting volume, launching external applications, writing files) trigger a modal **Confirmation Dialog** requiring explicit user approval.

---

## Voice Interaction

- **Push-to-Talk:** Press and hold the on-screen microphone button or hit the configured keyboard shortcut to dictate your prompt.
- **Speech-to-Text (STT):** Powered by local `whisper.cpp` with quantized models for near real-time voice transcription.
- **Text-to-Speech (TTS):** Powered by local `Piper` neural voice synthesizer for natural offline spoken responses.
- **Languages:** English, Hindi, and Hinglish.
- **Wake-Word Limitation:** Continuous neural wake-word detection is experimental and not certified in v0.1.1; the application uses reliable push-to-talk activation by default.

---

## Diagnostics & Recovery

When you need to verify system health or troubleshoot issues, RYPER provides built-in diagnostic tools under **Settings > Diagnostics**:
- **Health Cards:** Real-time status cards for Local AI Engine, Audio Subsystem, Storage, and System Broker.
- **Copy Diagnostics:** Generates a full system diagnostic summary. The diagnostic copy function **automatically sanitizes** personal usernames, user profile directory paths, and machine names.
- **Local AI Recovery:** If the local `llama.cpp` server encounters a crash or port conflict, click **"Restart Server"** or **"Re-download Model"** to self-heal the environment without reinstalling.

---

## Known Limitations

RYPER AI OS v0.1.1 has the following documented limitations:
1. **Continuous Wake-Word:** Continuous hands-free wake-word detection is not certified; use push-to-talk or manual activation.
2. **TTS Human Auditory Verification:** Synthetic audio pipeline tests pass; acoustic quality tuning across all Windows audio devices is ongoing.
3. **Completed-Action Retries:** Edge-case retry scenarios for interrupted multi-step tool calls are undergoing further verification.
4. **Cold-Start Latency:** First tool turn requires 70–120s on CPU or hybrid offload due to schema compilation.
5. **In-Process Plugins:** The plugin SDK currently runs within the main process context; process-level plugin sandboxing is planned for v0.2.0.
6. **Plaintext Settings Storage:** Application settings and optional API keys are currently stored in unencrypted JSON at `%APPDATA%\ryper-ai-os\settings.json`.
7. **Unsigned Installer:** Windows SmartScreen will display an "Unknown Publisher" prompt until an Authenticode certificate is provisioned.
8. **Manual Updates:** Automatic silent background updates are not enabled; new versions are installed via installer downloads.

---

## Platform Support Matrix

| Platform | Current Status | Notes |
| :--- | :---: | :--- |
| **Windows 10/11 x64** | **Released (v0.1.1)** | Fully supported, tested, packaged as NSIS installer. |
| **macOS (Apple Silicon / Intel)** | *Planned* | Architectural stubs present; not packaged or released. |
| **Linux (x86_64 / ARM64)** | *Planned* | Platform detection stubs present; not packaged or released. |
| **Android** | *Planned* | Architecture and contract definitions only; unreleased. |
| **iOS / iPadOS** | *Planned* | Architecture and contract definitions only; unreleased. |
| **Web Browser** | *Prototype Only* | Development shell for UI component testing; no OS integration. |

---

## Documentation

- 📖 **[User Guide](docs/USER_GUIDE.md):** Complete walkthrough for installation, onboarding, voice, diagnostics, and recovery.
- 🔒 **[Security Policy](.github/SECURITY.md):** Vulnerability reporting process and security disclosures.
- 📜 **[Third-Party Notices](THIRD_PARTY_NOTICES.md):** Attributions and licenses for bundled engines, models, and libraries.
- 🤝 **[Contributing Guidelines](CONTRIBUTING.md):** How to contribute to RYPER AI OS.
- ⚖️ **[Code of Conduct](CODE_OF_CONDUCT.md):** Community behavioral standards.
- 📝 **[Architecture Decision Records](docs/adr/):** Technical design records documenting architecture decisions.

---

## Local Development

To run and build RYPER AI OS from source on Windows:

### Prerequisites
- Node.js 20.x or 22.x (LTS recommended)
- npm 10.x+
- Git for Windows
- Visual Studio Build Tools / C++ build tools (for native bindings if compiling local tools)

### Setup Instructions
```bash
# 1. Clone repository
git clone https://github.com/anuraaag23/RYPER-AI-OS.git
cd RYPER-AI-OS

# 2. Install workspace dependencies
npm install

# 3. Run the automated test suite
npm test

# 4. Start the desktop application in development mode
npm run dev --workspace=@ryper/desktop-app
```

---

## Bug Reports & Feedback

Found a bug or have a suggestion?
- 🐛 **[Report a Bug](https://github.com/anuraaag23/RYPER-AI-OS/issues/new?template=bug_report.yml)**
- 💡 **[Request a Feature](https://github.com/anuraaag23/RYPER-AI-OS/issues/new?template=feature_request.yml)**
- 🔒 **[Report a Security Vulnerability](https://github.com/anuraaag23/RYPER-AI-OS/security/advisories/new)**

---

## License

RYPER AI OS is licensed under the **[MIT License](LICENSE)**.
Bundled models, inference runtimes, and third-party components are subject to their respective open-source licenses detailed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

# RYPER AI OS — User Guide

Welcome to **RYPER AI OS**! This guide walks you through downloading, installing, configuring, and using RYPER AI OS on Windows 10 and 11.

---

## Table of Contents
1. [Downloading the Installer](#1-downloading-the-installer)
2. [Installing the Application](#2-installing-the-application)
3. [Windows SmartScreen Warning](#3-windows-smartscreen-warning)
4. [First Launch](#4-first-launch)
5. [The Onboarding Wizard](#5-the-onboarding-wizard)
6. [Understanding Local AI Status](#6-understanding-local-ai-status)
7. [Starting Your First Conversation](#7-starting-your-first-conversation)
8. [Windows Automation & Permission Prompts](#8-windows-automation--permission-prompts)
9. [Safe Actions vs. Confirmation Actions](#9-safe-actions-vs-confirmation-actions)
10. [Using Voice & Push-to-Talk](#10-using-voice--push-to-talk)
11. [Multi-Language Support (English, Hindi, Hinglish)](#11-multi-language-support)
12. [System Diagnostics & Health Cards](#12-system-diagnostics--health-cards)
13. [Local AI Recovery Controls](#13-local-ai-recovery-controls)
14. [Customizing Settings](#14-customizing-settings)
15. [Uninstalling RYPER AI OS](#15-uninstalling-ryper-ai-os)
16. [Known Limitations & Tips](#16-known-limitations--tips)

---

## 1. Downloading the Installer

Official installer releases are hosted on GitHub:
- Visit the official release page: [RYPER AI OS v0.1.1 Release](https://github.com/anuraaag23/RYPER-AI-OS/releases/tag/v0.1.1)
- Download the installer file: `RYPER.AI.OS.Setup.0.1.1.exe` (~101 MB)

### Verifying File Integrity
Before running the installer, verify the SHA-256 hash using Windows PowerShell:
```powershell
Get-FileHash ".\RYPER.AI.OS.Setup.0.1.1.exe" -Algorithm SHA256
```
The hash should match:
```text
BAFB215CAF0763F5FCDCDB9DD01E750FEB08BF0C50054610E10131B988F61267
```

---

## 2. Installing the Application

1. Double-click `RYPER.AI.OS.Setup.0.1.1.exe` to launch the setup wizard.
2. Select whether to install for the current user or all users (administrator privileges optional).
3. Follow the installation prompts to select the destination folder (default: `%LOCALAPPDATA%\Programs\RYPER AI OS`).
4. Click **Install**. The setup wizard copies application files, registers file associations, and creates desktop/Start menu shortcuts.
5. On the final screen, check **Run RYPER AI OS** and click **Finish**.

---

## 3. Windows SmartScreen Warning

Because RYPER AI OS is currently in open beta and does not yet use an expensive corporate Authenticode signing certificate, Windows Defender SmartScreen may display:

> **"Windows protected your PC"**  
> *Microsoft Defender SmartScreen prevented an unrecognized app from starting. Running this app might put your PC at risk.*

### How to Proceed:
1. Click the underlined link **"More info"**.
2. Verify that the app name reads `RYPER AI OS Setup 0.1.1.exe`.
3. Click the **"Run anyway"** button that appears.

This is standard behavior for open-source Windows desktop software prior to commercial code-signing.

---

## 4. First Launch

When RYPER AI OS starts:
- The desktop window opens with the sleek dark-themed workspace.
- The application automatically verifies your local environment, checking for CPU instruction support (AVX2), memory availability, and audio hardware.
- If this is your first time opening the app, the **Onboarding Wizard** will appear automatically.

---

## 5. The Onboarding Wizard

The onboarding flow has three guided steps:

1. **Step 1: Welcome & Overview**  
   Introduces the privacy-first architecture and explains how RYPER runs on your PC.
2. **Step 2: Local AI Model Setup**  
   Configures the local intelligence engine. You can let RYPER automatically download the default lightweight Qwen 2.5 1.5B GGUF model (~1.1 GB), choose an existing model file on your drive, or select fallback mode. A live progress bar tracks model downloading.
3. **Step 3: Voice & Audio Setup**  
   Tests microphone input and speaker output for speech-to-text (`whisper.cpp`) and voice synthesis (`Piper`). You can set your preferred language (English, Hindi, or Hinglish).

Click **Finish Setup** to enter the main chat workspace.

---

## 6. Understanding Local AI Status

In the top header bar, a status pill shows the operational state of the local AI engine:

- 🟢 **Ready:** The local `llama.cpp` server is running on `127.0.0.1:8080` with the model loaded in memory. Queries will be processed locally.
- 🟡 **Downloading / Initializing:** Model weights are downloading, or the model is being loaded into RAM/VRAM.
- 🔴 **Offline / Error:** The local server is stopped, or a port conflict occurred. Click the indicator to view diagnostics or restart the server.
- ⚪ **Fallback Mode:** Running in mock/fallback mode without active local inference.

---

## 7. Starting Your First Conversation

Type your query in the prompt input at the bottom of the screen and press **Enter** (or click the Send button).

### What you can ask:
- **General Queries:** "Explain quantum computing in simple terms", "Draft an email requesting a deadline extension".
- **Code Assistance:** "Write a Python script to parse a CSV file and plot a chart".
- **System Automation:** "Turn the volume down to 30%", "Open Notepad", "Show me how much free RAM I have".

> [!TIP]
> **Cold-Start Latency:** On systems using CPU inference or limited VRAM, your first tool-enabled message may take 70–120 seconds while the model pre-caches tool schemas. Subsequent turns in the conversation will respond much faster!

---

## 8. Windows Automation & Permission Prompts

RYPER is deeply integrated with Windows 10/11 through a secure Capability Broker. When you ask RYPER to perform an action on your PC, it parses the intent and generates a structured tool call.

If the requested action modifies system state or accesses sensitive areas, RYPER pauses and displays a **Confirmation Dialog**:
- **Action Type:** e.g. "Adjust System Volume" or "Launch Application"
- **Target / Parameters:** e.g. `Volume: 30%` or `Path: notepad.exe`
- **Options:** Click **"Allow"** to execute, or **"Deny"** to cancel.

---

## 9. Safe Actions vs. Confirmation Actions

| Category | Actions | Requires Confirmation? |
| :--- | :--- | :---: |
| **System Info** | Query battery level, CPU load, memory usage, OS version | ❌ No (Read-only) |
| **Volume Control** | Set volume level, mute, unmute | ⚠️ Yes |
| **App Launch** | Open Calculator, Notepad, Spotify, File Explorer | ⚠️ Yes |
| **Process Control** | Terminate an unresponsive background process | ⚠️ Yes |
| **Filesystem** | Search files in user directory | ❌ No (Read-only) |
| **File Creation** | Create, edit, or delete files on disk | ⚠️ Yes |

---

## 10. Using Voice & Push-to-Talk

RYPER supports complete hands-free and voice interaction:

### Push-to-Talk
1. Click and hold the **Microphone** icon next to the chat bar (or hold down the configured shortcut key).
2. Speak your command naturally.
3. Release the button when finished speaking.
4. `whisper.cpp` transcribes your speech and inputs the text into the chat bar.

### Voice Responses
When voice mode is enabled, RYPER speaks its responses aloud using the offline `Piper` TTS neural voice synthesizer. You can toggle voice responses on or off anytime via the speaker icon in the header.

---

## 11. Multi-Language Support

RYPER AI OS supports:
- **English:** Full recognition and natural spoken output.
- **Hindi (हिंदी):** Native Hindi transcription and high-quality voice synthesis.
- **Hinglish:** Natural conversational code-switching common in multilingual workflows.

You can change your preferred voice language anytime in **Settings > Voice**.

---

## 12. System Diagnostics & Health Cards

To check system status, click the **Settings** gear icon in the sidebar and navigate to the **Diagnostics** tab:

- **Local AI Engine Card:** Shows model path, RAM/VRAM offload, process ID, and server response latency.
- **Audio Subsystem Card:** Shows active microphone and speaker devices, STT status, and TTS voice model loaded.
- **System Broker Card:** Shows registered capabilities and permission broker status.
- **Copy Diagnostics:** Click **"Copy Diagnostics"** to copy a sanitized diagnostic report to your clipboard. The copy action **automatically strips** your Windows username, home folder paths, and computer hostname for privacy before copying.

---

## 13. Local AI Recovery Controls

If the local AI server ever becomes unresponsive (e.g. after your PC resumes from sleep):
1. Open **Settings > Diagnostics**.
2. Look for the **Troubleshooting & Recovery** section.
3. Click **"Restart Server"**: RYPER gracefully stops the existing `llama.cpp` process and launches a fresh instance.
4. Click **"Re-download Model"**: If model weights were corrupted, this re-verifies and re-fetches the GGUF weights.
5. Click **"Open Logs Folder"**: Opens the local log directory (`%APPDATA%\ryper-ai-os\logs`) in Windows File Explorer for manual inspection.

---

## 14. Customizing Settings

Access settings via the gear icon in the bottom-left corner:
- **General:** Dark/Light theme, startup behavior, notification preferences.
- **Model:** Change local model path, configure GPU layer offload, or enter custom cloud API keys (OpenAI / Anthropic / OpenRouter) if you choose to use cloud models.
- **Voice:** Input device selection, output device selection, TTS speaking rate, language preference.
- **Privacy & Permissions:** Reset granted capability permissions, view local data folder.

---

## 15. Uninstalling RYPER AI OS

If you ever wish to remove RYPER AI OS:
1. Open Windows **Settings > Apps > Installed apps** (or **Add or Remove Programs**).
2. Find **RYPER AI OS** in the list.
3. Click the three dots and select **Uninstall**.
4. The uninstaller removes application binaries, shortcuts, and registry entries.
5. *Optional:* To remove cached models and configuration files, delete the folder:
   `%APPDATA%\ryper-ai-os`

---

## 16. Known Limitations & Tips

- **Memory Management:** Running local 1.5B–7B models requires available RAM. Close heavy background applications (like large games or video editors) if you experience stuttering.
- **Wake-Word:** Continuous hands-free wake-word detection is currently experimental. For the best experience, use Push-to-Talk.
- **Storage:** Downloaded GGUF models are stored in `%APPDATA%\ryper-ai-os\models`. Ensure your system drive has at least 3–5 GB of free space.

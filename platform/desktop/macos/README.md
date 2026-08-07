# macOS Desktop Shell

Native AppKit/SwiftUI shell, per the approved architecture (§4, §10, §20).

**Status: scaffold only.** This sandboxed Linux build environment has no
Xcode toolchain, so `swift build` cannot be verified here. `Package.swift`
below is a real, syntactically complete Swift Package Manager manifest;
open it in Xcode (or run `swift build` on macOS) to produce the first real
build.

## Responsibilities

- Renders the Glass Dock / Floating Assistant / Voice Orb using
  `NSVisualEffectView` materials themed from `ui/design-system` tokens.
- Bridges to Core over the same gRPC IPC contract as the other desktop
  shells.
- Owns macOS-specific integrations: Keychain-backed secret storage,
  Spotlight-adjacent file search, terminal (bash/zsh) integration, on-device
  Speech framework for wake word/STT, AVSpeechSynthesizer for TTS.

## Local setup (once on macOS)

```bash
xcode-select --install
swift build
```

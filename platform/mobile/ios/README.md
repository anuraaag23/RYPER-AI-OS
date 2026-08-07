# iOS / iPadOS Shell

Native SwiftUI shell, per the approved architecture (§4, §10, §20).

**Status: scaffold only.** No Xcode toolchain is available in this
sandboxed Linux build environment, so this package has not been built or
opened in Xcode. `Package.swift` below is a complete, valid Swift Package
Manager manifest; open the folder in Xcode (or run `swift build` on macOS)
to produce the first real build.

## Responsibilities

- Renders the Glass Dock / Floating Assistant / Voice Orb using
  `.ultraThinMaterial`/`.regularMaterial`, themed from `ui/design-system`
  tokens (ported to a Swift token file at implementation time).
- Bridges to Core over the gRPC IPC contract.
- Owns iOS-specific integrations within Apple's platform constraints:
  widgets (WidgetKit), Shortcuts (App Intents), Live Activities, on-device
  Speech framework, file provider extension for document access.
- **Hard constraint carried over from the architecture:** no attempt to run
  persistent background wake-word listening beyond what Apple's APIs permit
  — the lock-screen/voice UX here is built around Shortcuts and Live
  Activities instead, per the architecture's Risk Analysis (§15).

## Local setup (once on macOS with Xcode)

```bash
xcode-select --install
open Package.swift   # or: swift build
```

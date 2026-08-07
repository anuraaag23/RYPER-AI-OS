# Android Shell

Native Jetpack Compose shell, per the approved architecture (§4, §10, §20).

**Status: scaffold only.** No Android SDK/Gradle distribution is available
in this sandboxed build environment, so `./gradlew build` has not been run
against this module. The Gradle Kotlin DSL files below are complete and
valid; the first task once this repo is opened in Android Studio is to let
Gradle sync and run a debug build.

## Responsibilities

- Renders the Glass Dock / Floating Assistant / Voice Orb using Compose
  `Modifier.blur` plus a custom shader for chromatic edge refraction where
  the device GPU supports it, themed from `ui/design-system` tokens (ported
  to a Kotlin token object at implementation time).
- Bridges to Core over the gRPC IPC contract, or direct JNI/UniFFI bindings
  if Core is compiled as a shared Rust library for this target.
- Owns Android-specific integrations: widgets, quick settings tile,
  notifications, Bluetooth/Wi-Fi, camera, Android Keystore-backed encrypted
  storage, on-device offline AI via NNAPI.

## Local setup (once in Android Studio)

```bash
./gradlew assembleDebug
```

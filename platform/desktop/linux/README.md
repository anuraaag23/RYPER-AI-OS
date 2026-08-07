# Linux Desktop Shell

Native GTK4 shell, per the approved architecture (§4, §10, §20).

**Status: scaffold only.** The sandboxed build environment used to generate
this repository does not have GTK4 development headers or a Rust toolchain
installed (network egress here is restricted to package registries, not
apt/rustup installers), so `cargo build` has not been executed against this
crate. `Cargo.toml` below is a complete, valid manifest for a `gtk4-rs`
application; the first task on a real Linux dev machine is
`sudo apt install libgtk-4-dev` followed by `cargo build`.

## Responsibilities

- Renders the Glass Dock / Floating Assistant / Voice Orb using GTK4's
  blur/shadow primitives themed from `ui/design-system` tokens (ported to a
  GTK CSS provider at implementation time).
- Bridges to Core over the same gRPC IPC contract as the other desktop
  shells (Core itself is intended to be a Rust crate per the architecture's
  Technology Selection, so this shell can link it directly via FFI rather
  than only over IPC — an optimization the Windows/macOS shells don't have).
- Owns Linux-specific integrations: Secret Service (libsecret) for secrets,
  bash/zsh terminal integration, D-Bus based automation triggers.

## Local setup (once on Linux with GTK4 + Rust installed)

```bash
sudo apt install libgtk-4-dev build-essential
curl https://sh.rustup.rs -sSf | sh
cargo build
```

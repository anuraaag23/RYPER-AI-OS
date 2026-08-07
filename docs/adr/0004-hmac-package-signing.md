# ADR 0004: HMAC package signing as the Store's trust primitive

**Status:** Accepted (Phase 9)

## Context

The brief asks the platform to "design the architecture for a future
Plugin Store" including "package format, signing support, version
compatibility, update metadata, trust validation" while explicitly saying
"do not implement the online store yet." A real store's trust model
normally needs asymmetric (public-key) signing with a published trust
root, so third parties can verify a package without holding a shared
secret — infrastructure this phase has no server, key-management service,
or publishing pipeline to build against.

## Decision

Implement `signPackage`/`verifyPackageSignature` in `store-format.ts` with
HMAC-SHA256 over a canonicalized package envelope (manifest + entry +
checksum), verified with a constant-time comparison
(`node:crypto`'s `timingSafeEqual`). This is a real, working integrity and
authenticity check today — not a stub that always returns `true` — but it
assumes signer and verifier share a symmetric key, which only makes sense
for a single trusted publisher (e.g. this repo's own first-party plugins),
not an open multi-publisher store.

## Consequences

- Package tampering and wrong-key verification are both genuinely
  detected today (see `test/store-format.test.ts`), so the format and
  signing _shape_ other code (`PluginInstaller`, a future store client)
  can be built against is real and stable.
- The scheme is explicitly **not** what a public Plugin Store would ship
  with — moving to RSA/Ed25519 with a published trust root is future
  work, called out both in code comments and in
  `core/plugin-platform/README.md`'s limitations section, and does not
  require changing any caller of `signPackage`/`verifyPackageSignature`
  (same function signatures, same envelope shape).
- No online store client, package registry, or download/publish flow was
  built in this phase, per the brief's explicit instruction.

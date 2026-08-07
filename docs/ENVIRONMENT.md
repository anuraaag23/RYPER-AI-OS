# Environment Variables

All environment variables RYPER reads are declared in
[`.env.example`](../.env.example) — that file is the single source of truth
for names and shapes. This document explains what each group is for.

| Variable                                               | Purpose                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `RYPER_ENV`                                            | `development` \| `staging` \| `production`. Gates dev-only conveniences (e.g. unsigned plugin loading).                               |
| `RYPER_LOG_LEVEL`                                      | Minimum level passed to `@ryper/logging`'s `createLogger`.                                                                            |
| `RYPER_CLOUD_API_BASE_URL`                             | Base URL for the cloud `ModelProvider` implementation registered with `@ryper/model-router`.                                          |
| `RYPER_CLOUD_API_KEY`                                  | Local-dev-only credential. Never read from here in production — see `docs/SECRETS.md`.                                                |
| `RYPER_SYNC_RELAY_URL` / `RYPER_SYNC_ENABLED`          | Configure the optional end-to-end-encrypted sync relay used by `@ryper/sync`. Disabled unless explicitly turned on.                   |
| `RYPER_TELEMETRY_ENABLED` / `RYPER_TELEMETRY_ENDPOINT` | Wired directly to `@ryper/telemetry`'s `TelemetryConfig.enabled`. Defaults to `false`; the client sends nothing until this is `true`. |
| `RYPER_FEATURE_*`                                      | Feature flags for functionality still gated behind the roadmap (multi-agent orchestration, knowledge graph).                          |

## Loading order

1. Platform shell reads `.env` (local dev) or the platform's native config
   mechanism (packaged builds) at startup.
2. Values are validated against the shape in `.env.example` before any Core
   module is constructed — an unset required variable should fail startup
   loudly, not be silently defaulted somewhere deep in a module.
3. Secrets (`RYPER_CLOUD_API_KEY` and friends) are the one category **not**
   read this way in production — see `docs/SECRETS.md`.

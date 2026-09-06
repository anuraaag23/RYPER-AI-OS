# Logging

Every package logs through `@ryper/logging`'s `createLogger(scope)` — never
through `console.*` directly (enforced by the root ESLint config's
`no-console` rule, which only allows `console.error` as a last-resort sink
inside the logger implementation itself).

## Conventions

- **Scope naming:** the package name without the `@ryper/` prefix (e.g.
  `createLogger("model-router")`). Use `.child("sub-area")` for finer
  granularity (e.g. `logger.child("routing-decision")`).
- **Levels:**
  - `debug` — verbose, developer-only detail (disabled by default in
    `RYPER_LOG_LEVEL`).
  - `info` — normal operational events (routing decisions, plugin
    registration, sync merges).
  - `warn` — recoverable problems (a skipped automation action due to a
    missing capability grant).
  - `error` — failures that need attention (a handler threw, a plugin
    failed to load).
- **Structured fields, not string interpolation:** pass context as the
  second `fields` argument (`logger.info("routing decision", { target,
reason })`) rather than building the detail into the message string, so
  log records stay machine-parseable JSON.
- **No secrets in logs:** never log API keys, tokens, or raw user message
  content at `info` or above — see `docs/SECRETS.md`.

## Output format

The default sink (`jsonConsoleSink`) writes newline-delimited JSON records
(`{ timestamp, level, scope, message, fields }`) to stdout (`debug`/`info`)
or stderr (`warn`/`error`). Platform shells may swap in a different `LogSink`
(e.g. one that also writes to a native OS log) via `LoggerOptions.sink`
without changing any call site.

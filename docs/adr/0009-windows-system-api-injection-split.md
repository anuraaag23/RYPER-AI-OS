# ADR 0009: `WindowsSystemApi` injection, split into an in-memory reference and a PowerShell production shim

**Status:** Accepted (Phase 11)

## Context

`core/windows-agent` is the first production `PlatformAdapter`. The
build environment for this phase is a Linux container with no
`powershell.exe`, no WMI, and no Windows — the same constraint every
prior hardware-adjacent phase has hit (Phase 6's audio devices, Phase
9's sandbox process limits, Phase 10's null adapter). The brief still
requires real unit/integration tests exercised without live
network/hardware, and a real production code path a Windows-hosted shell
can use.

## Decision

1. **A single seam, `WindowsSystemApi`**, is the only thing any manager
   (`ProcessManager`, `FileManager`, `RegistryInterface`, ...) or
   `WindowsAdapter` itself ever calls. No file in this package imports
   `child_process`, `node:fs`, or any Win32/WinRT binding directly.
2. **Two implementations ship, both real:**
   - `InMemoryWindowsSystemApi` — a fully functional, stateful
     implementation (an actual process table, window list, virtual
     filesystem, registry map, service list, event log). Every operation
     is observable: killing a process really removes it from the next
     `listProcesses()`. This is the default `WindowsSystemApi` and what
     every test in this package runs against.
   - `PowerShellWindowsSystemApi` — the production shape. Every method
     builds a real PowerShell/CIM/WMI command string
     (`Get-CimInstance Win32_OperatingSystem`, `Get-Service`,
     `Set-ItemProperty`, ...) piped through `ConvertTo-Json`, and parses
     the (real, JSON-shaped) result. It depends on one injected
     function, `ShellExec`, to actually run a command. The package's
     default `ShellExec` (`unavailableShellExec`) always rejects,
     explaining plainly that no native Windows toolchain exists in this
     sandbox — it does not pretend to succeed, and it does not shell out
     to a nonexistent `powershell.exe`.
3. Tests for `PowerShellWindowsSystemApi` inject a fake `ShellExec` that
   returns canned PowerShell-shaped stdout, verifying **command
   construction and JSON-output parsing** — never real OS behavior,
   which this sandbox cannot provide.

## Consequences

- Every manager, and `WindowsAdapter` itself, is testable today with
  zero mocking of the manager layer — swap in
  `InMemoryWindowsSystemApi` and every operation actually does
  something.
- A real Windows-hosted shell adopting this package supplies a real
  `ShellExec` (e.g. wrapping `child_process.execFile("powershell.exe",
...)`) and gets a working `PowerShellWindowsSystemApi` with zero
  changes to `windows-adapter.ts` or any manager — the injection point
  is the only thing that changes between "sandbox" and "real Windows."
- The tradeoff, stated plainly in `README.md`'s "Honest Limitations":
  `PowerShellWindowsSystemApi`'s command strings are never executed
  against a real Windows machine in this repository's test suite or CI.
  Confidence that the commands themselves are correct PowerShell is
  necessarily lower than confidence in `InMemoryWindowsSystemApi`'s
  behavior, and should be verified against a real Windows host before
  first production use.

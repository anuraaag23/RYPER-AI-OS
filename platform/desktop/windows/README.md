# Windows Desktop Shell

Native WinUI 3 / Win32 shell, per the approved architecture (§4, §10, §20).

**Status: scaffold only.** This sandboxed build environment has no Windows
SDK, MSVC toolchain, or WinUI workload available, so no `.sln`/`.csproj`
build has been generated here — doing so without the ability to actually
compile it would risk shipping a project file that silently doesn't build.
`RyperOS.Desktop.Windows.csproj` below is a real, complete, schema-valid
starting point; the first task once this repo is opened on a Windows
machine with Visual Studio 2022 + the "Windows App SDK" workload installed
is to run `dotnet build` against it and commit the resulting lockfile.

## Responsibilities

- Renders the Glass Dock / Floating Assistant / Voice Orb using WinUI's
  `Mica`/`Acrylic` materials, themed from `ui/design-system`'s tokens
  (ported to a `.editorconfig`-consistent C# token file at that time).
- Bridges to Core (`core/*`) over the gRPC IPC contract defined in the
  architecture's API Contracts section — Core itself does not run on
  .NET; this shell is a thin client.
- Owns Windows-specific integrations: PowerShell/CMD terminal integration,
  window management, clipboard, screenshot/screen recording, wake word via
  a Windows-supported on-device speech API.

## Local setup (once on Windows)

```powershell
winget install Microsoft.VisualStudio.2022.Community
dotnet workload install windowsappsdk
dotnet build RyperOS.Desktop.Windows.csproj
```

# Exposed dist:win entrypoint. All build/runtime pins and bundling live in shared scripts.
# Production requires a real OEM payload. -DevWithoutOemKernel explicitly opts into a development artifact.
[CmdletBinding()]
param(
    [switch]$DevWithoutOemKernel,
    [switch]$SkipDependencyInstall,
    [switch]$CheckOnly,
    [switch]$MainOnly,
    [string]$MainOutDir
)
$ErrorActionPreference = 'Stop'
$ElectronDir = Split-Path -Parent $PSScriptRoot
$RootDir = Split-Path -Parent (Split-Path -Parent $ElectronDir)
$buildArgs = @((Join-Path $RootDir 'scripts\build\windows-release.ts'))
if ($DevWithoutOemKernel) { $buildArgs += '--development-without-oem' }
if ($SkipDependencyInstall) { $buildArgs += '--skip-install' }
if ($CheckOnly) { $buildArgs += '--check-only' }
if ($MainOnly) { $buildArgs += '--main-only' }
if ($MainOutDir) { $buildArgs += @('--outdir', $MainOutDir) }
Push-Location $RootDir
try {
    # argv paths, never interpolate Windows/Unicode paths into JavaScript source.
    & bun @buildArgs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { Pop-Location }

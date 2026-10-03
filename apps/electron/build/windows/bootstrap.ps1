[CmdletBinding()]
param(
    [string]$ResourcesRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$DataRoot = (Join-Path $env:LOCALAPPDATA 'Rox\bootstrap'),
    [ValidateSet('auto', 'bundled', 'system')][string]$Mode = 'auto',
    [switch]$InstallLinuxSupport,
    [switch]$InstallGitBash,
    [switch]$InspectOnly
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'dependency-functions.ps1')
. (Join-Path $PSScriptRoot 'linux-support.ps1')

function Write-RoxBootstrapReceipt {
    param($Report)
    $null = New-Item -ItemType Directory -Force -Path $DataRoot
    $pending = Join-Path $DataRoot ('status-' + [guid]::NewGuid().ToString('N') + '.json')
    $json = $Report | ConvertTo-Json -Depth 8
    Set-Content -LiteralPath $pending -Value $json -Encoding UTF8
    Move-Item -LiteralPath $pending -Destination (Join-Path $DataRoot 'status.json') -Force
}

$lock = $null

try {
    if (-not [Environment]::Is64BitProcess) { throw 'Bootstrap requires 64-bit Windows PowerShell' }
    if (-not $InspectOnly) {
        $null = New-Item -ItemType Directory -Force -Path $DataRoot
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        do {
            try { $lock = [IO.File]::Open((Join-Path $DataRoot 'bootstrap.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
            catch [IO.IOException] {
                if ([DateTime]::UtcNow -ge $deadline) { throw 'Another Windows bootstrap is still running' }
                Start-Sleep -Milliseconds 200
            }
        } until ($lock)
    }
    $payloadRoot = Join-Path $ResourcesRoot 'windows-dependencies'
    $manifest = Get-Content -LiteralPath (Join-Path $payloadRoot 'manifest.json') -Raw | ConvertFrom-Json
    $cacheRoot = Join-Path $DataRoot 'dependencies'
    $tools = @(Resolve-WindowsDependencies $manifest $payloadRoot $cacheRoot $Mode -InspectOnly:$InspectOnly)
    $report = [ordered]@{
        schemaVersion = 1; mode = $Mode; platform = 'win32-x64'; tools = $tools
        nativeReady = @($tools | Where-Object { $_.source -eq 'missing' -or $_.source -eq 'bundled-pending' }).Count -eq 0
        pathEntries = @($tools | Where-Object { $_.executable } | ForEach-Object { Split-Path -Parent $_.executable } | Select-Object -Unique)
        linuxSupport = @{ phase = 'not-selected'; code = 0 }
        gitBash = (Resolve-OptionalGitBash $manifest $payloadRoot $cacheRoot $Mode -Selected:$InstallGitBash -InspectOnly:$InspectOnly)
    }
    if ($InstallLinuxSupport) {
        if ($InspectOnly) { $report.linuxSupport = @{ phase = 'selected-not-provisioned'; code = 0 } }
        else { $report.linuxSupport = Install-RoxLinuxSupport }
    }
    $json = $report | ConvertTo-Json -Depth 8
    if (-not $InspectOnly) { Write-RoxBootstrapReceipt $report }
    $json
    if (@($tools | Where-Object { $_.source -eq 'missing' }).Count) { exit 2 }
    if ($report.linuxSupport.code -eq 3010) { exit 3010 }
    if ($report.linuxSupport.code -ne 0) { exit 3 }
    exit 0
} catch {
    $failure = $_
    if (-not $InspectOnly -and $lock) {
        try { Write-RoxBootstrapReceipt @{ schemaVersion = 1; mode = $Mode; platform = 'win32-x64'; nativeReady = $false;
            phase = 'native-bootstrap-failed'; error = $failure.Exception.Message; code = 1 } } catch { # Preserve the original failure.
        }
    }
    Write-Error $failure -ErrorAction Continue
    exit 1
} finally { if ($lock) { $lock.Dispose() } }

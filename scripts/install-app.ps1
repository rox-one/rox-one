# Rox Windows Installer
# Usage: irm https://thecraftagents.com/install-app.ps1 | iex
param(
    [ValidateSet('auto', 'bundled', 'system')][string]$DependencyMode,
    [switch]$InstallLinuxSupport,
    [switch]$InstallGitBash
)

& {
$ErrorActionPreference = "Stop"

$VERSIONS_URL = "https://thecraftagents.com/electron"
$DOWNLOAD_DIR = "$env:TEMP\craft-agent-install"
$APP_NAME = "Rox"

# Colors for output
function Write-Info { Write-Host "> $args" -ForegroundColor Blue }
function Write-Success { Write-Host "> $args" -ForegroundColor Green }
function Write-Warn { Write-Host "! $args" -ForegroundColor Yellow }
function Write-Err { Write-Host "x $args" -ForegroundColor Red; exit 1 }

function Get-RoxCommandLauncher {
    # Only fixed launcher text goes through cmd.exe. Registry paths remain data
    # inside the PowerShell helper and are never interpolated into a shell line.
    return '@echo off' + "`r`n" + 'setlocal DisableDelayedExpansion' + "`r`n" + '@"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0rox-launch.ps1" %*' + "`r`n"
}

function Get-RoxLauncherScript {
    # Self-contained for irm | iex distribution. Fixed ASCII source; paths are
    # read as Unicode registry values at invocation, including after upgrades.
    return @'
$ErrorActionPreference = 'Stop'

function Read-RoxInstallLocation {
    param([string]$Hive, [string]$View, [string]$Key)
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::$Hive, [Microsoft.Win32.RegistryView]::$View)
    try {
        $entry = $base.OpenSubKey($Key, $false)
        if (-not $entry) { return $null }
        try { return $entry.GetValue('InstallLocation', $null) } finally { $entry.Dispose() }
    } finally { $base.Dispose() }
}

function Resolve-RoxInstalledExecutable {
    param([scriptblock]$ReadRegistry = ${function:Read-RoxInstallLocation})
    # UUIDv5(com.lukilabs.craft-agent, electron-builder NS UUID), same key as NSIS.
    $guid = '61dc82ee-e3b9-557b-98c4-20b9178a0f78'
    $keys = @("Software\$guid", "Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid")
    foreach ($hive in @('CurrentUser', 'LocalMachine')) {
        foreach ($view in @('Registry64', 'Registry32')) {
            foreach ($key in $keys) {
                $location = & $ReadRegistry $hive $view $key
                if (-not ($location -is [string]) -or [string]::IsNullOrWhiteSpace($location)) { continue }
                # Do not consume UninstallString/DisplayIcon command lines. Only
                # an absolute InstallLocation directory plus the known exe name.
                if (-not [IO.Path]::IsPathRooted($location) -or $location -match '["\x00]' -or
                    $location -notmatch '^(?:[a-zA-Z]:[\\/]|\\\\[^\\]+\\[^\\]+)') { continue }
                try {
                    $exe = [IO.Path]::GetFullPath((Join-Path $location 'Rox.exe'))
                    if (Test-Path -LiteralPath $exe -PathType Leaf) { return $exe }
                } catch { # Ignore invalid/stale registration, not a shell command.
                }
            }
        }
    }
    throw 'Registered Rox.exe was not found. Reinstall Rox or repair its NSIS InstallLocation registration.'
}

function ConvertTo-RoxWindowsArgument {
    param([AllowEmptyString()][string]$Argument)
    if ($Argument.Contains([string][char]0)) { throw 'NUL is not allowed in a process argument' }
    # Windows CRT argv quoting: double backslashes before quotes and before
    # the closing quote. No cmd.exe, Invoke-Expression, or PowerShell evaluation.
    $escaped = [regex]::Replace($Argument, '(\\*)"', '${1}${1}\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '${1}${1}')
    return '"' + $escaped + '"'
}

function Invoke-RoxRegisteredApp {
    param([string]$Executable, [string[]]$Arguments)
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $Executable
    $start.UseShellExecute = $false
    $start.Arguments = ($Arguments | ForEach-Object { ConvertTo-RoxWindowsArgument $_ }) -join ' '
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    try { if (-not $process.Start()) { throw 'Rox process did not start' } }
    finally { $process.Dispose() }
}

if ($MyInvocation.InvocationName -ne '.') {
    try { Invoke-RoxRegisteredApp -Executable (Resolve-RoxInstalledExecutable) -Arguments $args }
    catch { Write-Error $_ -ErrorAction Continue; exit 1 }
}
'@
}

# Check for Windows
if ($env:OS -ne "Windows_NT") {
    Write-Err "This installer is for Windows only."
}

# Detect architecture
$arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
if ($arch -ne 'x64') { Write-Err 'Rox supports 64-bit Windows only.' }
$platform = "win32-$arch"

Write-Host ""
Write-Info "Detected platform: $platform (arch: $arch)"

# Create download directory
New-Item -ItemType Directory -Force -Path $DOWNLOAD_DIR | Out-Null

# Fetch YAML manifest directly from /electron/latest/ (no version endpoint needed)
Write-Info "Fetching release info..."
$yamlPath = Join-Path $DOWNLOAD_DIR "latest.yml"
try {
    Invoke-WebRequest -Uri "$VERSIONS_URL/latest/latest.yml" -OutFile $yamlPath -UseBasicParsing
} catch {
    Write-Err "Failed to fetch release info: $_"
}

$yamlContent = Get-Content $yamlPath -Raw
if (-not $yamlContent) {
    Write-Err "Failed to fetch release info from latest.yml"
}

# Extract version from YAML manifest
$version = $null
if ($yamlContent -match '(?m)^version:\s*(.+)') {
    $version = $Matches[1].Trim()
}

if (-not $version) {
    Write-Err "Failed to extract version from manifest"
}

Write-Info "Latest version: $version"

# Parse YAML to extract sha512, url (filename), and size for our architecture
# YAML format:
#   files:
#     - url: Craft-Agents-x64.exe
#       sha512: <base64>
#       size: 123456789
#       arch: x64
function Get-YamlEntryForArch {
    param([string]$yaml, [string]$targetArch)
    # electron-builder does not normally emit an `arch` property. Accept the
    # artifact's architecture suffix as well, without matching another arch.
    $blocks = [regex]::Matches($yaml, '(?ms)^\s*-\s*url:\s*([^\r\n]+)\r?\n(.*?)(?=^\s*-\s*url:|^\S|\z)')
    foreach ($block in $blocks) {
        $url = $block.Groups[1].Value.Trim().Trim('"', "'")
        $body = $block.Groups[2].Value
        $matchesArch = $url -match ('-' + [regex]::Escape($targetArch) + '\.exe$')
        if ($body -match '(?m)^\s*arch:\s*([^\r\n]+)') {
            $matchesArch = $Matches[1].Trim().Trim('"', "'") -eq $targetArch
        }
        if (-not $matchesArch -or $url -notmatch '^[A-Za-z0-9._-]+\.exe$') { continue }
        if ($body -notmatch '(?m)^\s*sha512:\s*([^\r\n]+)') { continue }
        $sha512 = $Matches[1].Trim().Trim('"', "'")
        $size = 0L
        if ($body -match '(?m)^\s*size:\s*(\d+)') { $size = [long]$Matches[1] }
        return @{ url = $url; sha512 = $sha512; size = $size }
    }
    return $null
}

$entry = Get-YamlEntryForArch -yaml $yamlContent -targetArch $arch

if (-not $entry) {
    Write-Err "Architecture $arch not found in latest.yml"
}

$checksum = $entry.sha512
$filename = $entry.url
$fileSize = $entry.size

# Validate checksum format (SHA-512 base64 = 88 characters)
if (-not $checksum -or $checksum.Length -lt 80) {
    Write-Err "Invalid checksum in manifest"
}

# Use default filename if not found
if (-not $filename) {
    $filename = "Rox-$arch.exe"
}

$installerUrl = "$VERSIONS_URL/latest/$filename"

Write-Info "Expected sha512: $($checksum.Substring(0, 20))..."

# Download installer with progress
$installerPath = Join-Path $DOWNLOAD_DIR $filename
$fileSizeMB = if ($fileSize -gt 0) { [math]::Round($fileSize / 1MB, 1) } else { 0 }

# Clean up any partial download from previous attempts
Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue

Write-Info "Downloading $filename ($fileSizeMB MB)..."

try {
    # Use WebRequest for download with progress
    $webRequest = [System.Net.HttpWebRequest]::Create($installerUrl)
    $webRequest.Timeout = 600000  # 10 minutes
    $response = $webRequest.GetResponse()
    $responseStream = $response.GetResponseStream()
    $fileStream = [System.IO.File]::Create($installerPath)

    $buffer = New-Object byte[] 65536
    $totalRead = 0
    $lastPercent = -1

    while (($read = $responseStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $fileStream.Write($buffer, 0, $read)
        $totalRead += $read

        if ($fileSize -gt 0) {
            $percent = [math]::Floor(($totalRead / $fileSize) * 100)
            if ($percent -ne $lastPercent) {
                $downloadedMB = [math]::Round($totalRead / 1MB, 1)
                $barWidth = 40
                # Cap at 100% for display (actual download may exceed manifest size slightly)
                $displayPercent = [math]::Min($percent, 100)
                $filled = [math]::Min([math]::Floor($displayPercent / (100 / $barWidth)), $barWidth)
                $bar = "[" + ("#" * $filled) + ("-" * ($barWidth - $filled)) + "]"
                Write-Host -NoNewline ("`r  $bar $percent% ($downloadedMB / $fileSizeMB MB)   ")
                $lastPercent = $percent
            }
        }
    }

    $fileStream.Close()
    $responseStream.Close()
    $response.Close()

    Write-Host ""
    Write-Success "Download complete!"
} catch {
    # Clean up partial download on failure
    if ($fileStream) { $fileStream.Close() }
    if ($responseStream) { $responseStream.Close() }
    if ($response) { $response.Close() }
    Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
    Write-Err "Download failed: $_"
}

# Verify file was downloaded
if (-not (Test-Path $installerPath)) {
    Write-Err "Download failed: file not found"
}

# Verify checksum (SHA-512, base64 encoded — matches electron-builder YAML manifest)
Write-Info "Verifying checksum..."
$sha512 = [System.Security.Cryptography.SHA512]::Create()
$stream = [System.IO.File]::OpenRead($installerPath)
$hashBytes = $sha512.ComputeHash($stream)
$stream.Close()
$sha512.Dispose()
$actualHash = [Convert]::ToBase64String($hashBytes)

if ($actualHash -ne $checksum) {
    Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
    Write-Err "Checksum verification failed`n  Expected: $checksum`n  Actual:   $actualHash"
}

Write-Success "Checksum verified!"

# Close the app if it's running
$process = Get-Process -Name $APP_NAME -ErrorAction SilentlyContinue
if ($process) {
    Write-Info "Closing Rox..."
    $process | Stop-Process -Force
    Start-Sleep -Seconds 2
}

# Run the installer
Write-Info "Running installer (follow the installer prompts)..."

try {
    $installerArgs = @()
    if ($DependencyMode) { $installerArgs += "/DEPENDENCIES=$DependencyMode" }
    if ($InstallLinuxSupport) { $installerArgs += '/WSL' }
    if ($InstallGitBash) { $installerArgs += '/GITBASH' }
    if ($installerArgs.Count) {
        $installerProcess = Start-Process -FilePath $installerPath -ArgumentList $installerArgs -PassThru
    } else {
        $installerProcess = Start-Process -FilePath $installerPath -PassThru
    }
    $spinner = @('|', '/', '-', '\')
    $i = 0

    while (-not $installerProcess.HasExited) {
        Write-Host -NoNewline ("`r  Installing... " + $spinner[$i % 4] + "   ")
        Start-Sleep -Milliseconds 200
        $i++
    }

    Write-Host -NoNewline "`r                      `r"

    if ($installerProcess.ExitCode -eq 3010) {
        Write-Warn 'WSL needs a restart. Restart later, then resume resources\windows-bootstrap\bootstrap.ps1 -InstallLinuxSupport.'
    } elseif ($installerProcess.ExitCode -ne 0) {
        Write-Err "Installation failed with exit code: $($installerProcess.ExitCode)"
    }
} catch {
    Write-Err "Installation failed: $_"
}

# Clean up installer
Write-Info "Cleaning up..."
Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue

# Add command line shortcut
Write-Info "Adding 'craft-agents' command to PATH..."

$binDir = "$env:LOCALAPPDATA\Rox\bin"
$cmdFile = "$binDir\craft-agents.cmd"

# Create bin directory
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

# Write a fixed ASCII wrapper and a UTF-8 PowerShell helper. Neither embeds a
# profile/install path; each invocation resolves the latest NSIS registration.
$cmdContent = Get-RoxCommandLauncher
Set-Content -Path $cmdFile -Value $cmdContent -Encoding ASCII
Set-Content -LiteralPath (Join-Path $binDir 'rox-launch.ps1') -Value (Get-RoxLauncherScript) -Encoding UTF8

# Add to user PATH if not already there
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($userPath -split ';' | ForEach-Object { $_.Trim().TrimEnd('\') }) -notcontains $binDir.TrimEnd('\')) {
    $newPath = "$userPath;$binDir"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Success "Added to PATH (restart terminal to use 'craft-agents' command)"
} else {
    Write-Success "Command 'craft-agents' is ready"
}

Write-Host ""
Write-Host "---------------------------------------------------------------------"
Write-Host ""
Write-Success "Installation complete!"
Write-Host ""
Write-Host "  Rox has been installed."
Write-Host ""
Write-Host "  Launch from:"
Write-Host "    - Start Menu or desktop shortcut"
Write-Host "    - Command line: craft-agents (restart terminal first)"
Write-Host ""
}

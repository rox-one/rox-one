# The ONLY elevated operation. Never reads/writes a user's dependency/profile data.
# Invoked via RunAs only after an explicit WSL selection. DISM cannot reboot here.
$ErrorActionPreference = 'Stop'
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 740 }
    $reboot = $false
    foreach ($feature in @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')) {
        & "$env:SystemRoot\System32\dism.exe" /Online /Enable-Feature "/FeatureName:$feature" /All /NoRestart
        if ($LASTEXITCODE -eq 3010) { $reboot = $true }
        elseif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    if ($reboot) { exit 3010 }
    & "$env:SystemRoot\System32\wsl.exe" --install --no-distribution --web-download
    exit $LASTEXITCODE
} catch { Write-Error $_ -ErrorAction Continue; exit 1 }

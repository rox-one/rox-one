# Optional, installation-time only. Import has no WSL, elevation or filesystem side effects.
function Invoke-RoxWsl {
    param([string[]]$Arguments)
    $wsl = "$env:SystemRoot\System32\wsl.exe"
    if (-not (Test-Path -LiteralPath $wsl)) { return @{ code = 2; stdout = '' } }
    # PS 5.1 turns native stderr into terminating errors under Stop; keep the
    # real native exit code so an optional WSL failure cannot masquerade as a
    # failure of the already-provisioned native dependencies.
    $ErrorActionPreference = 'Continue'
    $output = (& $wsl @Arguments 2>$null) -join "`n"
    return @{ code = $LASTEXITCODE; stdout = $output.Replace([string][char]0, '') }
}

function Install-RoxLinuxSupport {
    param([int]$WindowsBuild = [Environment]::OSVersion.Version.Build)
    if ($WindowsBuild -lt 19041) { return @{ phase = 'unsupported-os'; code = 50 } }
    $status = Invoke-RoxWsl @('--status')
    $defaultVersion = @{ code = 1 }
    if ($status.code -eq 0) { $defaultVersion = Invoke-RoxWsl @('--set-default-version', '2') }
    if ($status.code -ne 0 -or $defaultVersion.code -ne 0) {
        # Only the OS-feature worker is elevated. No profile/config paths are passed to it.
        $worker = Join-Path $PSScriptRoot 'enable-wsl.ps1'
        try {
            $child = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Verb RunAs -Wait -PassThru -ArgumentList (
                '-NoProfile -ExecutionPolicy Bypass -File "' + $worker + '"')
        } catch {
            $errorCause = $_.Exception.GetBaseException()
            if ($errorCause -is [ComponentModel.Win32Exception] -and $errorCause.NativeErrorCode -eq 1223) {
                return @{ phase = 'elevation-declined'; code = 1223 }
            }
            return @{ phase = 'elevation-failed'; code = 1 }
        }
        if ($child.ExitCode -eq 3010 -or $child.ExitCode -eq 1641) { return @{ phase = 'reboot-required'; code = 3010 } }
        if ($child.ExitCode -ne 0) { return @{ phase = 'feature-install-failed'; code = $child.ExitCode } }
        $defaultVersion = Invoke-RoxWsl @('--set-default-version', '2')
        if ($defaultVersion.code -ne 0) { return @{ phase = 'wsl2-not-ready'; code = $defaultVersion.code } }
    }
    # Distribution registration is per user and MUST run outside the elevated worker.
    $list = Invoke-RoxWsl @('--list', '--quiet')
    if ($list.code -ne 0) { return @{ phase = 'wsl-not-ready'; code = $list.code } }
    if (($list.stdout -split "`n" | ForEach-Object { $_.Trim() }) -notcontains 'Ubuntu') {
        $install = Invoke-RoxWsl @('--install', '--distribution', 'Ubuntu', '--no-launch', '--web-download')
        if ($install.code -eq 3010 -or $install.code -eq 1641) { return @{ phase = 'reboot-required'; code = 3010 } }
        if ($install.code -ne 0) { return @{ phase = 'distribution-install-failed'; code = $install.code } }
    } else {
        $versions = Invoke-RoxWsl @('--list', '--verbose')
        if ($versions.code -ne 0) { return @{ phase = 'wsl-not-ready'; code = $versions.code } }
        if ($versions.stdout -match '(?m)^\s*\*?\s*Ubuntu\s+.*\s1\s*$') {
            # Never convert an existing user's distro/data implicitly.
            return @{ phase = 'existing-wsl1-distribution'; code = 1; distribution = 'Ubuntu' }
        }
    }
    # Not runtime-ready until the user completes distro OOBE and Linux-specific helper setup.
    return @{ phase = 'user-setup-required'; code = 0; distribution = 'Ubuntu' }
}

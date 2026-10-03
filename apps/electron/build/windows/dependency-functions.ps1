# PowerShell 5.1; dot-sourceable for isolated validation. No side effects on import.
Set-StrictMode -Version Latest

function Join-DependencyPath {
    param([string]$Root, [string]$Relative)
    if ([string]::IsNullOrWhiteSpace($Relative) -or [IO.Path]::IsPathRooted($Relative) -or
        $Relative -match '(^|[\\/])\.\.([\\/]|$)|[:\x00]') { throw "Unsafe dependency path: $Relative" }
    $base = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $result = [IO.Path]::GetFullPath((Join-Path $Root $Relative))
    if (-not $result.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw 'Dependency path escapes root' }
    return $result
}

function Test-DependencyCommand {
    param([string]$Path, [string]$Name)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    # Probe only --version, never login, network access or user configuration.
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $Path
    $start.Arguments = '--version'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    try {
        if (-not $process.Start()) { return $false }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(10000)) { $process.Kill(); return $false }
        if ($process.ExitCode -ne 0) { return $false }
        $text = $stdout.Result + $stderr.Result
        switch ($Name) {
            'gh' { return $text -match '^gh version [2-9]\.' }
            'git' { return $text -match '^git version [2-9]\.' }
            'node' {
                if ($text -notmatch '^v(\d+\.\d+\.\d+)') { return $false }
                return [version]$Matches[1] -ge [version]'22.23.0'
            }
            'jq' { return $text -match '^jq-[1-9]\.' }
            'yq' { return $text -match 'version v?([4-9]|[1-9][0-9]+)\.' }
            'git-bash' { return $text -match '^GNU bash, version [4-9]\.' }
        }
        return $false
    } catch { return $false } finally { $process.Dispose() }
}

function Find-SystemDependency {
    param([string]$Name, [string]$SearchPath = $env:PATH, [string]$ExcludeRoot = '')
    foreach ($directory in ($SearchPath -split ';')) {
        $directory = $directory.Trim().Trim('"')
        if (-not $directory -or -not [IO.Path]::IsPathRooted($directory)) { continue }
        $candidate = Join-Path $directory "$Name.exe"
        if ($ExcludeRoot -and [IO.Path]::GetFullPath($candidate).StartsWith(
            [IO.Path]::GetFullPath($ExcludeRoot).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { continue }
        if (Test-DependencyCommand $candidate $Name) { return $candidate }
    }
    return $null
}

function Test-DependencyPayload {
    param([string]$Path, $Tool)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing offline payload: $Path" }
    if ((Get-Item -LiteralPath $Path).Length -ne $Tool.size -or
        (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Tool.sha256) {
        throw "Dependency payload size/SHA256 mismatch: $($Tool.name)"
    }
}

function Expand-DependencyArchive {
    param([string]$Path, [string]$Destination)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        foreach ($entry in $zip.Entries) {
            # Validate lexically: GetFullPath in .NET Framework rejects legitimate
            # deep npm paths before extraction. Rooted paths/ADS/traversal/symlinks
            # are rejected without imposing MAX_PATH on the archive contents.
            if ([IO.Path]::IsPathRooted($entry.FullName) -or
                $entry.FullName -match '(^|[\\/])\.{1,2}([\\/]|$)|[:\x00]' -or
                (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Unsafe dependency ZIP entry' }
        }
    } finally { $zip.Dispose() }
    # Windows' inbox bsdtar supports long npm paths; PS 5.1 Expand-Archive does not.
    $tar = "$env:SystemRoot\System32\tar.exe"
    if (-not (Test-Path -LiteralPath $tar)) { throw 'Windows inbox tar.exe is required (Windows 10 1803+)' }
    & $tar -xf $Path -C $Destination
    if ($LASTEXITCODE -ne 0) { throw "Dependency ZIP extraction failed: $LASTEXITCODE" }
}

function Remove-DependencyDirectory {
    param([string]$Path)
    # .NET Framework supports extended-length paths when passed explicitly. This
    # is necessary for npm's nested files and avoids masking extraction errors
    # with PowerShell's own MAX_PATH-limited recursive removal.
    if (Test-Path -LiteralPath $Path) { [IO.Directory]::Delete(('\\?\' + [IO.Path]::GetFullPath($Path)), $true) }
}

function Install-OfflineDependency {
    param($Tool, [string]$PayloadRoot, [string]$CacheRoot)
    if ($Tool.name -notin @('gh', 'git', 'node', 'jq', 'yq', 'git-bash') -or $Tool.version -notmatch '^[0-9][0-9.]*$' -or
        $Tool.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or $Tool.archive -notin @('zip', 'raw', '7z-sfx') -or
        @($Tool.binPaths).Count -eq 0) { throw 'Invalid dependency manifest entry' }
    $versionRoot = Join-DependencyPath $CacheRoot "$($Tool.name)/$($Tool.version)"
    $primary = Join-DependencyPath $versionRoot $Tool.binPaths[0]
    foreach ($bin in $Tool.binPaths) { $null = Join-DependencyPath $versionRoot $bin }
    $stampPath = Join-Path $versionRoot '.rox-payload.json'
    if (Test-Path -LiteralPath $stampPath -PathType Leaf) {
        try {
            $stamp = Get-Content -LiteralPath $stampPath -Raw | ConvertFrom-Json
            $allPresent = @($Tool.binPaths | Where-Object { -not (Test-Path -LiteralPath (Join-DependencyPath $versionRoot $_) -PathType Leaf) }).Count -eq 0
            if ($stamp.sha256 -eq $Tool.sha256 -and $allPresent -and
                (Get-FileHash -LiteralPath $primary -Algorithm SHA256).Hash -eq $stamp.executableSha256 -and
                (Test-DependencyCommand $primary $Tool.name)) { return $primary }
        } catch { # A corrupt cache is repaired using the verified payload below.
        }
    }
    $payload = Join-DependencyPath $PayloadRoot $Tool.payload
    Test-DependencyPayload $payload $Tool
    $parent = Split-Path -Parent $versionRoot
    $null = New-Item -ItemType Directory -Force -Path $parent
    $staging = Join-Path $parent ('.staging-' + [guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $staging
    try {
        if ($Tool.archive -eq 'zip') { Expand-DependencyArchive $payload $staging }
        elseif ($Tool.archive -eq '7z-sfx') {
            if ($Tool.name -ne 'git-bash') { throw 'Self-extraction is only supported for pinned PortableGit' }
            # This is the verified vendor portable extractor, not a Git installer:
            # no registry, global PATH, credential setup or post-install scripts.
            $start = New-Object Diagnostics.ProcessStartInfo
            $start.FileName = $payload
            $start.Arguments = '-y -o"' + $staging + '"'
            $start.UseShellExecute = $false
            $start.CreateNoWindow = $true
            $process = [Diagnostics.Process]::Start($start)
            try {
                if (-not $process.WaitForExit(90000)) { $process.Kill(); throw 'PortableGit extraction timed out' }
                if ($process.ExitCode -ne 0) { throw "PortableGit extraction failed: $($process.ExitCode)" }
            } finally { $process.Dispose() }
        }
        else {
            $target = Join-DependencyPath $staging $Tool.binPaths[0]
            $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target)
            Copy-Item -LiteralPath $payload -Destination $target
        }
        foreach ($bin in $Tool.binPaths) {
            if (-not (Test-Path -LiteralPath (Join-DependencyPath $staging $bin) -PathType Leaf)) { throw "Missing bundled executable: $bin" }
        }
        $stagedPrimary = Join-DependencyPath $staging $Tool.binPaths[0]
        if (-not (Test-DependencyCommand $stagedPrimary $Tool.name)) { throw "Bundled executable probe failed: $($Tool.name)" }
        @{ sha256 = $Tool.sha256; executableSha256 = (Get-FileHash -LiteralPath $stagedPrimary -Algorithm SHA256).Hash } |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $staging '.rox-payload.json') -Encoding UTF8
        # Only our versioned dependency cache is replaced. Other versions remain usable.
        Remove-DependencyDirectory $versionRoot
        [IO.Directory]::Move($staging, $versionRoot)
        return $primary
    } finally {
        Remove-DependencyDirectory $staging
    }
}

function Resolve-OptionalGitBash {
    param($Manifest, [string]$PayloadRoot, [string]$CacheRoot, [string]$Mode, [switch]$Selected, [switch]$InspectOnly)
    if (-not $Manifest.PSObject.Properties['optionalGitBash'] -or $Mode -eq 'system') { return $null }
    $tool = $Manifest.optionalGitBash
    $exe = Join-DependencyPath $CacheRoot "$($tool.name)/$($tool.version)/$($tool.binPaths[0])"
    if ($Selected -and -not $InspectOnly) { $exe = Install-OfflineDependency $tool $PayloadRoot $CacheRoot }
    elseif (-not (Test-DependencyCommand $exe 'git-bash')) { return $null }
    return [pscustomobject]@{ name = 'git-bash'; source = 'bundled'; pinnedVersion = $tool.version; executable = $exe }
}

function Resolve-WindowsDependencies {
    param($Manifest, [string]$PayloadRoot, [string]$CacheRoot, [ValidateSet('auto', 'bundled', 'system')][string]$Mode,
        [string]$SearchPath = $env:PATH, [switch]$InspectOnly)
    if ($Manifest.schemaVersion -ne 1 -or $Manifest.platform -ne 'win32-x64') { throw 'Unsupported dependency manifest' }
    $tools = @()
    foreach ($tool in $Manifest.tools) {
        $exe = $null
        $source = 'missing'
        if ($Mode -ne 'bundled') {
            $exe = Find-SystemDependency $tool.name $SearchPath $CacheRoot
            if ($exe) { $source = 'system' }
        }
        if (-not $exe -and $Mode -ne 'system') {
            if ($InspectOnly) {
                $source = 'bundled-pending'
            } else {
                $exe = Install-OfflineDependency $tool $PayloadRoot $CacheRoot
                $source = 'bundled'
            }
        }
        $tools += [pscustomobject]@{ name = $tool.name; pinnedVersion = $tool.version; source = $source; executable = $exe }
    }
    return $tools
}

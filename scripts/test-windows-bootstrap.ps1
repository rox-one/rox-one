# Safe local validation: fixture files only under an explicit temporary root.
# No network, WSL calls, elevation, global installs, PATH edits or profile/config reads.
param([Parameter(Mandatory = $true)][string]$TempRoot)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Join-Path $TempRoot ('rox-bootstrap-test-' + [guid]::NewGuid().ToString('N'))
if (-not (Test-Path -LiteralPath $TempRoot -PathType Container)) { throw 'Temporary parent must exist' }
$null = New-Item -ItemType Directory -Path $root
$build = Join-Path (Split-Path -Parent $PSScriptRoot) 'apps\electron\build\windows'
. (Join-Path $build 'dependency-functions.ps1')
. (Join-Path $build 'linux-support.ps1')
$script:checks = 0
function Assert($condition, [string]$message) {
    if (-not $condition) { throw "FAIL: $message" }
    $script:checks++
}
function Assert-Throws([scriptblock]$action, [string]$message) {
    $threw = $false
    try { & $action | Out-Null } catch { $threw = $true }
    Assert $threw $message
}
try {
    # Parse every shipped PowerShell entrypoint without executing any of them.
    foreach ($file in Get-ChildItem -LiteralPath $build -Filter '*.ps1') {
        $tokens = $null; $errors = $null
        $null = [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
        Assert ($errors.Count -eq 0) "PowerShell syntax: $($file.Name)"
    }
    # Load just the YAML parser AST from the public downloader; never execute its
    # network/process/PATH-editing entrypoint.
    $tokens = $null; $errors = $null
    $downloader = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'install-app.ps1'), [ref]$tokens, [ref]$errors)
    Assert ($errors.Count -eq 0) 'download helper PowerShell syntax'
    $parser = $downloader.Find({ param($ast) $ast -is [Management.Automation.Language.FunctionDefinitionAst] -and $ast.Name -eq 'Get-YamlEntryForArch' }, $true)
    . ([scriptblock]::Create($parser.Extent.Text))
    $yaml = "version: 1.0.0`nfiles:`n  - url: Rox-arm64.exe`n    sha512: ARM`n    size: 1`n  - url: 'Rox-x64.exe'`n    sha512: 'HASH'`n    size: 42`npath: Rox-x64.exe`nsha512: TOPLEVEL`n"
    $entry = Get-YamlEntryForArch $yaml 'x64'
    Assert ($entry.url -eq 'Rox-x64.exe' -and $entry.sha512 -eq 'HASH' -and $entry.size -eq 42) 'architecture suffix works without a manifest arch property'
    Assert ($null -eq (Get-YamlEntryForArch ($yaml.Replace('Rox-x64.exe', 'Rox-x86.exe')) 'x64')) 'download helper rejects other architectures'
    Assert ($null -eq (Get-YamlEntryForArch ($yaml.Replace('Rox-x64.exe', '../Rox-x64.exe')) 'x64')) 'download helper rejects unsafe filenames'
    $legacy = "files:`n  - url: installer.exe`n    sha512: HASH`n    size: 42`n    arch: x64`n"
    Assert ((Get-YamlEntryForArch $legacy 'x64').url -eq 'installer.exe') 'explicit architecture manifest remains supported'
    $fixture = Join-Path $root 'fixture.exe'
    Add-Type -OutputAssembly $fixture -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.IO;
public class FixtureCLI {
  public static int Main(string[] args) {
    string name = Path.GetFileNameWithoutExtension(Environment.GetCommandLineArgs()[0]);
    if (name == "Rox") {
      File.WriteAllText(Environment.GetEnvironmentVariable("ROX_LAUNCHER_MARKER"), string.Join("|", args));
      return 0;
    }
    if (args.Length != 1 || args[0] != "--version") return 1;
    switch (name) {
      case "gh": Console.WriteLine("gh version 2.97.0"); break;
      case "git": Console.WriteLine("git version 2.55.0.windows.3"); break;
      case "node": Console.WriteLine("v22.23.1"); break;
      case "jq": Console.WriteLine("jq-1.8.1"); break;
      case "yq": Console.WriteLine("yq version v4.53.3"); break;
      default: Console.WriteLine("not a supported CLI"); break;
    }
    return 0;
  }
}
'@
    # Import the self-contained launcher factories without running the downloader.
    foreach ($name in @('Get-RoxCommandLauncher', 'Get-RoxLauncherScript')) {
        $factory = $downloader.Find({ param($ast) $ast -is [Management.Automation.Language.FunctionDefinitionAst] -and $ast.Name -eq $name }, $true)
        . ([scriptblock]::Create($factory.Extent.Text))
    }
    $cmdContent = Get-RoxCommandLauncher
    Assert (-not $cmdContent.Contains('Programs\Rox')) 'cmd wrapper contains no install-location guess'
    Assert ($cmdContent.Contains('%~dp0rox-launch.ps1')) 'fixed wrapper delegates registered-path lookup to helper'
    $unicodeProfile = Join-Path $root ('profile-' + [char]0x7528 + [char]0x6237 + [char]0x0416)
    $launcherDir = Join-Path $unicodeProfile 'bin with spaces'
    $null = New-Item -ItemType Directory -Path $launcherDir -Force
    $library = Join-Path $launcherDir 'rox-launch-library.ps1'
    Set-Content -LiteralPath $library -Value (Get-RoxLauncherScript) -Encoding UTF8
    . $library
    Assert ($null -eq (Read-RoxInstallLocation 'CurrentUser' 'Registry64' ('Software\RoxLauncherMissing-' + [guid]::NewGuid().ToString('N')))) 'production registry API reads a missing key without creating it'
    $guidKey = 'Software\61dc82ee-e3b9-557b-98c4-20b9178a0f78'
    $script:registrations = @{}
    $reader = { param($Hive, $View, $Key) return $script:registrations["$Hive/$View/$Key"] }
    $launchScript = Join-Path $launcherDir 'rox-launch.ps1'
    # Child fixture overrides only the registry read boundary. No actual registry
    # writes/lookup, real Rox startup, user PATH changes or profile edits.
    Set-Content -LiteralPath $launchScript -Encoding UTF8 -Value @'
. (Join-Path $PSScriptRoot 'rox-launch-library.ps1')
$fixtureLocation = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'registration.json') -Raw | ConvertFrom-Json
$reader = { param($Hive, $View, $Key)
  if ($Hive -eq 'CurrentUser' -and $View -eq 'Registry64' -and $Key -eq 'Software\61dc82ee-e3b9-557b-98c4-20b9178a0f78') { return $fixtureLocation }
  return $null
}
Invoke-RoxRegisteredApp -Executable (Resolve-RoxInstalledExecutable -ReadRegistry $reader) -Arguments $args
'@
    $launcher = Join-Path $launcherDir 'craft-agents.cmd'
    Set-Content -LiteralPath $launcher -Value $cmdContent -Encoding ASCII
    foreach ($case in @('fresh', 'legacy-upgrade', 'custom-unicode-metacharacters')) {
        $appDir = switch ($case) {
            'fresh' { Join-Path $unicodeProfile 'Programs\Rox' }
            'legacy-upgrade' { Join-Path $unicodeProfile 'Programs\@roxelectron' }
            'custom-unicode-metacharacters' { Join-Path $unicodeProfile "custom O'Connor & literal %ROX_NOT_EXPANDED%" }
        }
        $null = New-Item -ItemType Directory -Path $appDir -Force
        Copy-Item -LiteralPath $fixture -Destination (Join-Path $appDir 'Rox.exe')
        $script:registrations = @{ "CurrentUser/Registry64/$guidKey" = $appDir }
        Assert ((Resolve-RoxInstalledExecutable -ReadRegistry $reader) -eq (Join-Path $appDir 'Rox.exe')) "registered executable resolves: $case"
        $appDir | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $launcherDir 'registration.json') -Encoding UTF8
        $marker = Join-Path $root "launcher-$case.txt"
        $start = New-Object Diagnostics.ProcessStartInfo
        $start.FileName = "$env:SystemRoot\System32\cmd.exe"
        $start.Arguments = '/d /c ""' + $launcher + '" --workspace "fixture argument spaced" --literal "A&B|<>""'
        $start.UseShellExecute = $false; $start.CreateNoWindow = $true
        $start.EnvironmentVariables['LOCALAPPDATA'] = $unicodeProfile
        $start.EnvironmentVariables['ROX_LAUNCHER_MARKER'] = $marker
        $child = [Diagnostics.Process]::Start($start)
        try {
            Assert ($child.WaitForExit(5000) -and $child.ExitCode -eq 0) "fixed launcher executes: $case"
            $deadline = [DateTime]::UtcNow.AddSeconds(5)
            while (-not (Test-Path -LiteralPath $marker) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 50 }
            Assert ((Get-Content -LiteralPath $marker -Raw) -eq '--workspace|fixture argument spaced|--literal|A&B|<>') "launcher forwards safe CLI arguments: $case"
        } finally { $child.Dispose() }
    }
    $fresh = Join-Path $unicodeProfile 'Programs\Rox'
    $legacy = Join-Path $unicodeProfile 'Programs\@roxelectron'
    $script:registrations = @{ "CurrentUser/Registry64/$guidKey" = $legacy; "LocalMachine/Registry64/$guidKey" = $fresh }
    Assert ((Resolve-RoxInstalledExecutable -ReadRegistry $reader) -eq (Join-Path $legacy 'Rox.exe')) 'per-user upgraded registration wins over machine registration'
    $script:registrations = @{ "CurrentUser/Registry64/$guidKey" = (Join-Path $root 'stale'); "CurrentUser/Registry32/$guidKey" = $fresh }
    Assert ((Resolve-RoxInstalledExecutable -ReadRegistry $reader) -eq (Join-Path $fresh 'Rox.exe')) 'stale registration falls back to valid alternate registry view'
    $script:registrations = @{ "CurrentUser/Registry64/$guidKey" = 'relative-path' }
    Assert-Throws { Resolve-RoxInstalledExecutable -ReadRegistry $reader } 'relative registry paths fail closed'
    $script:registrations = @{ "CurrentUser/Registry64/$guidKey" = ($fresh + '" & echo injected') }
    Assert-Throws { Resolve-RoxInstalledExecutable -ReadRegistry $reader } 'command-shaped registry strings are not evaluated'
    Assert ((ConvertTo-RoxWindowsArgument 'C:\trailing\') -eq '"C:\trailing\\"') 'native argv quotes trailing backslashes'
    Assert ((ConvertTo-RoxWindowsArgument '') -eq '""') 'native argv preserves empty arguments'
    $argvMarker = Join-Path $root 'native-argv-marker.txt'
    $previousMarker = $env:ROX_LAUNCHER_MARKER
    try {
        $env:ROX_LAUNCHER_MARKER = $argvMarker
        Invoke-RoxRegisteredApp -Executable (Join-Path $fresh 'Rox.exe') -Arguments @('', 'quoted"value', 'C:\trailing\', '& echo never-evaluated')
        $deadline = [DateTime]::UtcNow.AddSeconds(5)
        while (-not (Test-Path -LiteralPath $argvMarker) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 50 }
        Assert ((Get-Content -LiteralPath $argvMarker -Raw) -eq '|quoted"value|C:\trailing\|& echo never-evaluated') 'direct native launch preserves empty/quoted/trailing-backslash argv without evaluation'
    } finally { $env:ROX_LAUNCHER_MARKER = $previousMarker }
    $payload = Join-Path $root 'payload with spaces'
    $cache = Join-Path $root "cache with 'quotes'"
    $system = Join-Path $root 'system tools'
    $null = New-Item -ItemType Directory -Path $payload, $system
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $tools = @()
    foreach ($name in @('gh', 'git', 'node', 'jq', 'yq')) {
        Copy-Item -LiteralPath $fixture -Destination (Join-Path $system "$name.exe")
        $dir = Join-Path $root "zip-$name"
        $null = New-Item -ItemType Directory -Path (Join-Path $dir 'bin')
        Copy-Item -LiteralPath $fixture -Destination (Join-Path $dir "bin\$name.exe")
        $zip = Join-Path $payload "$name.zip"
        [IO.Compression.ZipFile]::CreateFromDirectory($dir, $zip)
        $tools += [pscustomobject]@{
            name = $name; version = '1.0.0'; payload = "$name.zip"; archive = 'zip'
            sha256 = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
            size = (Get-Item -LiteralPath $zip).Length; binPaths = @("bin/$name.exe")
        }
    }
    $manifest = [pscustomobject]@{ schemaVersion = 1; platform = 'win32-x64'; tools = $tools }
    $resolved = @(Resolve-WindowsDependencies $manifest $payload $cache 'auto' $system)
    Assert (@($resolved | Where-Object { $_.source -ne 'system' }).Count -eq 0) 'auto respects usable system CLIs'
    Assert (-not (Test-Path -LiteralPath $cache)) 'auto does not install when system dependencies work'
    $resolved = @(Resolve-WindowsDependencies $manifest $payload $cache 'system' '')
    Assert (@($resolved | Where-Object { $_.source -eq 'missing' }).Count -eq 5) 'system never falls back to bundle'
    Assert (-not (Test-Path -LiteralPath $cache)) 'system mode writes nothing'
    $resolved = @(Resolve-WindowsDependencies $manifest $payload $cache 'bundled' $system)
    Assert (@($resolved | Where-Object { $_.source -ne 'bundled' }).Count -eq 0) 'bundled ignores system PATH'
    $stamp = Join-Path $cache 'gh\1.0.0\.rox-payload.json'
    $before = (Get-Item -LiteralPath $stamp).LastWriteTimeUtc
    $null = Resolve-WindowsDependencies $manifest $payload $cache 'bundled' ''
    Assert ((Get-Item -LiteralPath $stamp).LastWriteTimeUtc -eq $before) 'second run reuses cache without rewriting'
    Set-Content -LiteralPath $resolved[0].executable -Value 'corrupt binary'
    $null = Resolve-WindowsDependencies $manifest $payload $cache 'bundled' ''
    Assert (Test-DependencyCommand $resolved[0].executable 'gh') 'corrupt installed executable is repaired'
    Assert (-not (Test-DependencyCommand $fixture 'gh')) 'unrelated executable is rejected'
    # Raw executable artifacts exercise the jq/yq release layout as well as ZIP tools.
    Copy-Item -LiteralPath $fixture -Destination (Join-Path $payload 'gh.exe')
    $rawTool = [pscustomobject]@{ name = 'gh'; version = '2.0.0'; payload = 'gh.exe'; archive = 'raw';
        size = (Get-Item -LiteralPath $fixture).Length; sha256 = (Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash;
        binPaths = @('bin/gh.exe') }
    $rawExe = Install-OfflineDependency $rawTool $payload $cache
    Assert (Test-DependencyCommand $rawExe 'gh') 'raw payload installation'
    $rawTool.sha256 = '0' * 64
    Assert-Throws { Install-OfflineDependency $rawTool $payload $cache } 'checksum mismatch fails closed'
    Assert-Throws { Join-DependencyPath $cache '../escape.exe' } 'path traversal rejected'
    Assert-Throws { Join-DependencyPath $cache 'C:\escape.exe' } 'absolute path rejected'
    $evilZip = Join-Path $root 'evil.zip'
    $archive = [IO.Compression.ZipFile]::Open($evilZip, [IO.Compression.ZipArchiveMode]::Create)
    $null = $archive.CreateEntry('../escape.exe'); $archive.Dispose()
    Assert-Throws { Expand-DependencyArchive $evilZip (Join-Path $root 'extract') } 'ZIP traversal rejected before extraction'
    $inspect = Join-Path $root 'inspect cache'
    $null = Resolve-WindowsDependencies $manifest $payload $inspect 'bundled' '' -InspectOnly
    Assert (-not (Test-Path -LiteralPath $inspect)) 'inspection is read-only'
    $longSource = Join-Path $root 'long-source'
    $deep = $longSource + ('\nested-node-module' * 20)
    $null = [IO.Directory]::CreateDirectory(('\\?\' + $deep))
    [IO.File]::WriteAllText(('\\?\' + $deep + '\fixture.txt'), 'long path fixture')
    $longZip = Join-Path $root 'long-path.zip'
    # .NET's archive writer also needs extended-length source paths.
    [IO.Compression.ZipFile]::CreateFromDirectory(('\\?\' + $longSource), $longZip)
    $longDest = Join-Path $root 'long-extract'
    $null = New-Item -ItemType Directory -Path $longDest
    Expand-DependencyArchive $longZip $longDest
    Assert ([IO.File]::Exists(('\\?\' + $longDest + ('\nested-node-module' * 20) + '\fixture.txt'))) 'ZIP extraction supports long npm paths'
    Remove-DependencyDirectory $longDest
    Assert (-not (Test-Path -LiteralPath $longDest)) 'long dependency trees can be removed during repair'

    # Replace both external-operation boundaries before testing any WSL branch.
    $script:wslCalls = @(); $script:adminCalls = 0
    $script:statusCode = 0; $script:adminCode = 0; $script:distros = 'Ubuntu'; $script:installCode = 0; $script:distroVersion = 2
    function Invoke-RoxWsl([string[]]$Arguments) {
        $script:wslCalls += ($Arguments -join ' ')
        if ($Arguments[0] -eq '--status') { return @{ code = $script:statusCode; stdout = '' } }
        if ($Arguments[0] -eq '--set-default-version') { return @{ code = 0; stdout = '' } }
        if ($Arguments[0] -eq '--list' -and $Arguments[1] -eq '--verbose') { return @{ code = 0; stdout = "  Ubuntu  Stopped  $script:distroVersion" } }
        if ($Arguments[0] -eq '--list') { return @{ code = 0; stdout = $script:distros } }
        return @{ code = $script:installCode; stdout = '' }
    }
    function Start-Process {
        param($FilePath, $Verb, [switch]$Wait, [switch]$PassThru, $ArgumentList)
        $script:adminCalls++
        if ($script:adminCode -eq 1223) { throw (New-Object ComponentModel.Win32Exception(1223)) }
        return [pscustomobject]@{ ExitCode = $script:adminCode }
    }
    $wsl = Install-RoxLinuxSupport 19040
    Assert ($wsl.phase -eq 'unsupported-os' -and $script:wslCalls.Count -eq 0) 'old Windows is rejected without WSL calls'
    $wsl = Install-RoxLinuxSupport 22631
    Assert ($wsl.phase -eq 'user-setup-required' -and $script:adminCalls -eq 0) 'existing WSL/distro needs no elevation'
    Assert ($script:wslCalls -notcontains '--install --distribution Ubuntu --no-launch --web-download') 'existing Ubuntu is not installed twice'
    $script:distroVersion = 1
    $wsl = Install-RoxLinuxSupport 22631
    Assert ($wsl.phase -eq 'existing-wsl1-distribution' -and $script:wslCalls -notcontains '--set-version Ubuntu 2') 'existing WSL1 data is not implicitly converted'
    $script:distroVersion = 2
    $script:statusCode = 1; $script:adminCode = 3010; $script:wslCalls = @()
    $wsl = Install-RoxLinuxSupport 22631
    Assert ($wsl.code -eq 3010 -and $script:wslCalls.Count -eq 1) 'reboot stops provisioning before distro registration'
    $script:adminCode = 1223
    $wsl = Install-RoxLinuxSupport 22631
    Assert ($wsl.phase -eq 'elevation-declined') 'UAC cancellation remains actionable'
    $script:adminCode = 5
    $wsl = Install-RoxLinuxSupport 22631
    Assert ($wsl.phase -eq 'feature-install-failed' -and $wsl.code -eq 5) 'feature errors are not reported as ready'
    $script:statusCode = 0; $script:distros = ''; $script:wslCalls = @()
    $wsl = Install-RoxLinuxSupport 22631
    Assert ($script:wslCalls -contains '--install --distribution Ubuntu --no-launch --web-download') 'distro registration uses unprivileged no-launch path'
    $script:installCode = 9
    $wsl = Install-RoxLinuxSupport 22631
    Assert ($wsl.phase -eq 'distribution-install-failed') 'distro errors are surfaced'

    # Invoke the real entrypoint in a child process with fixtures; no WSL option.
    $resources = Join-Path $root 'resources'
    $null = New-Item -ItemType Directory -Path $resources
    Copy-Item -LiteralPath $payload -Destination (Join-Path $resources 'windows-dependencies') -Recurse
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $resources 'windows-dependencies\manifest.json') -Encoding UTF8
    $entryData = Join-Path $root 'entrypoint data'
    $ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $output = & $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $build 'bootstrap.ps1') -ResourcesRoot $resources -DataRoot $entryData -Mode bundled
    Assert ($LASTEXITCODE -eq 0) 'real bootstrap entrypoint succeeds on offline fixtures'
    $report = Get-Content -LiteralPath (Join-Path $entryData 'status.json') -Raw | ConvertFrom-Json
    Assert ($report.linuxSupport.phase -eq 'not-selected') 'native bootstrap never invokes WSL'
    Assert ($report.pathEntries.Count -eq 5) 'report exposes explicit child PATH entries'
    # Corrupt an offline payload and a cache entry so recovery cannot reuse it.
    Set-Content -LiteralPath $report.tools[0].executable -Value 'corrupt cache'
    Set-Content -LiteralPath (Join-Path $resources 'windows-dependencies\gh.zip') -Value 'corrupt archive'
    $ErrorActionPreference = 'Continue'
    try { $output = & $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $build 'bootstrap.ps1') -ResourcesRoot $resources -DataRoot $entryData -Mode bundled 2>$null }
    finally { $ErrorActionPreference = 'Stop' }
    Assert ($LASTEXITCODE -eq 1) 'entrypoint fails on corrupt payload'
    $failure = Get-Content -LiteralPath (Join-Path $entryData 'status.json') -Raw | ConvertFrom-Json
    Assert ($failure.phase -eq 'native-bootstrap-failed' -and -not $failure.nativeReady) 'failure receipt replaces stale ready state'
    $readOnlyData = Join-Path $root 'read-only entrypoint'
    $output = & $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $build 'bootstrap.ps1') -ResourcesRoot $resources -DataRoot $readOnlyData -Mode bundled -InspectOnly -InstallLinuxSupport
    Assert ($LASTEXITCODE -eq 0 -and -not (Test-Path -LiteralPath $readOnlyData)) 'entrypoint inspection with WSL selected remains read-only'
    "PASS: $script:checks Windows bootstrap checks (offline fixtures; mocked WSL/elevation)"
} finally { Remove-DependencyDirectory $root }

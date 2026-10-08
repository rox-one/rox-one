# Windows installer/bootstrap integration

## Command launcher and registered installation paths

The download helper creates a fixed ASCII `craft-agents.cmd` wrapper plus a
UTF-8 `rox-launch.ps1`. The helper resolves the current NSIS `InstallLocation`
each time it is invoked, using the app's exact electron-builder GUID in HKCU
first, then HKLM, with 64/32-bit registry-view fallbacks. It does not assume
`Programs\Rox`: an upgraded `Programs\@craft-agentelectron` registration or a
custom Unicode install directory is honored. A stale/invalid registration is
reported rather than launching an unrelated guessed executable.

Only an absolute registered directory plus `Rox.exe` is accepted. Registry
paths are Unicode data passed to `ProcessStartInfo.FileName` with
`UseShellExecute=false`; they are never inserted into cmd/PowerShell source,
evaluated, or taken from an `UninstallString` command. CLI arguments use explicit
Windows argv quoting. Regression fixtures cover fresh installs, legacy upgrades,
custom Unicode/apostrophe/percent/ampersand paths, view fallbacks, invalid paths,
and argument preservation. No regression launches the real installed app or
writes installation registry keys.

## Production Windows release gate and exposed entrypoint

`bun run dist:win` from `apps/electron` calls `scripts/build-win.ps1`, which now
delegates to `scripts/build/windows-release.ts`. It uses the canonical
`scripts/electron-build-main.ts` (including ONNX/transformers/sharp exclusions,
native SQLite and polyfill aliases), and the common Bun/uv staging functions.
SDK cross-fetch reads `package.json` as UTF-8 JSON, not an interpolated JavaScript
string containing the Windows profile path. The exposed release entrypoint does not kill unrelated
node/npm/Electron processes or depend on Bash/WSL for OEM staging.

Production preflight runs before dependency installation/downloads/builds. The
Windows `beforePack` hook enforces the same gate for direct builder entrypoints,
and stages packaged Bun/uv/SDK as well as native CLI prerequisites. It requires a
Windows x64 PE kernel plus nonempty `stage/` and `appearance/` assets. README-only
staging is an error. Supply the actual unpacked vendor tree:

```powershell
$env:OEM_KERNEL_PAYLOAD_DIR = 'C:\vendor\oem-payload' # contains win32-x64/
bun run dist:win # from apps/electron
```

The existing OEM pin hashes describe vendor **tarballs**, not a single executable.
This gate checks payload presence/platform/assets; it does not falsely claim to
verify an unpacked binary against a tarball digest. No vendor binary is created,
downloaded or fabricated by these scripts. Vendor archive provenance remains a
release-input responsibility.

If the vendor payload is unavailable, explicitly request a development-only build:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File apps/electron/scripts/build-win.ps1 -DevWithoutOemKernel -SkipDependencyInstall
```

That flag sets both `ROX_WINDOWS_DEV_WITHOUT_OEM=1` and `CRAFT_DEV_RUNTIME=1` for
the child build. Child processes receive an explicit environment snapshot;
Bun on Windows otherwise loses mutations when `execFileSync` inherits its
original OS environment. The resulting artifact is `Rox-development-x64.exe`, stamped
`roxWindowsBuild: optional-development`, and requires `--publish never`. It is
unsigned and skips executable resource editing, avoiding winCodeSign's
privilege-dependent symlink extraction for this development-only mode. It is
not a production managed-knowledge build. A plain `CRAFT_DEV_RUNTIME=1` does not
bypass the OEM release gate.

Windows file filters are combined into one allowlist before packing, avoiding
builder's negative-only `win.files` matcher copying the entire source/build tree.
The original settings are restored in the afterPack wrapper, which delegates to
the existing macOS icon hook. Pinned dependency payloads are excluded from
re-signing so their published hashes remain valid. NSIS custom page function
bodies are emitted after builder's plugin header, when StdUtils is available.

Read-only preflight: `build-win.ps1 -CheckOnly`. Isolated main compilation:
`build-win.ps1 -MainOnly -MainOutDir <temporary-output-directory>`; this mode
skips worker/resource/install/packaging steps and build-time credential defines.
It is a syntax/bundle check, never a release.

Windows extraResources now explicitly include `@tursodatabase/database`,
`database-common` and `database-win32-x64-msvc`. The native smoke copies exactly
those configured entries to a temporary package, loads the facade and NAPI addon,
and runs an in-memory query, without starting Rox or opening a user's WorkGraph.

## Native contract

Every Windows x64 electron-builder invocation runs `build/beforePack.cjs`. It
uses the build host's Bun (`ROX_BUILD_BUN` may be an absolute executable path)
to run `scripts/stage-windows-dependencies.ts`. The script reads, but never
changes, `packages/shared/src/toolchain/manifest-data.ts`. It downloads pinned
native `gh`, MinGit, Node, jq and yq payloads, verifies SHA256 **and size**, reuses
verified downloads, and removes stale build payloads. A missing/corrupt release
fails the build. The installer needs no network for these native dependencies.
Release archives retain vendor license files. Bun and uv remain in the existing
packaged locations; their build pins now match the runtime pins.

The staged payload also includes optional **full PortableGit 2.55.0.3**, pinned
separately in `packages/shared/src/toolchain/windows-git-bash-pin.ts`. Its vendor
release SHA-256 and size are verified before its portable extractor runs. It
provides native `bin/bash.exe`, the MSYS runtime and full Git support without
installing Git globally. MinGit remains the ordinary native Git prerequisite.

The assisted NSIS installer offers `auto` (default), `bundled`, and `system`:

- `auto`: prefer usable system `.exe` files on an absolute PATH directory;
  install missing tools from the packaged payloads.
- `bundled`: use pinned private payloads, regardless of system PATH.
- `system`: detect only; never install a fallback. Missing tools return exit 2.

Native installation uses `%LOCALAPPDATA%\Rox\bootstrap\dependencies\<tool>\<version>`.
It does not modify global/user PATH, invoke winget/MSI/npm global installs,
authenticate gh, or touch the app's workspace/config/credential directories.
Verified usable versions are reused on upgrades/repeated runs; corrupt entries
are repaired. A private file lock serializes concurrent bootstrap attempts.
Windows inbox `tar.exe` extracts ZIPs without PowerShell 5.1's MAX_PATH limitation
on deep npm paths; extended-length directory cleanup supports cache repair.
The optional `DataRoot` argument enables isolated test profiles.
Old versions are retained to avoid deleting files used by running processes.
An app uninstall does not automatically remove this private cache or WSL.

The shipped entrypoint is:

```powershell
& "$InstallDir\resources\windows-bootstrap\bootstrap.ps1" -Mode auto
# Inspect only: probes --version, writes nothing, provisions nothing, even with WSL selected.
& "$InstallDir\resources\windows-bootstrap\bootstrap.ps1" -Mode system -InspectOnly
```

Install automation: `Rox-x64.exe /S /DEPENDENCIES=bundled`.
Optional WSL consent: `/WSL`. Updates retain the dependency mode in
`HKCU\Software\Rox\Installer\DependencyMode`, but never replay WSL consent.
Automatic post-install app launch is disabled so bootstrap failures/reboot needs
are not hidden behind startup. Installer labels use NSIS English/Russian language
resources because the installer runs before i18next exists.

Optional native Git Bash: select the separate installer checkbox, pass
`/GITBASH`, or run `bootstrap.ps1 -Mode auto -InstallGitBash`. The download helper
also accepts `-InstallGitBash`. This option is unchecked by default and is not
replayed automatically on upgrade. Existing valid private PortableGit is reused.
`system` mode never provisions or consumes private Git Bash. WSL is independent.

## Shared/toolchain + startup integration

`%LOCALAPPDATA%\Rox\bootstrap\status.json` is a **non-secret installer receipt**,
not shared toolchain state. It is atomically replaced after provisioning:

```json
{
  "schemaVersion": 1,
  "mode": "auto",
  "platform": "win32-x64",
  "nativeReady": true,
  "tools": [{"name": "gh", "pinnedVersion": "2.97.0", "source": "bundled", "executable": "absolute path"}],
  "pathEntries": ["absolute executable parent directory"],
  "linuxSupport": {"phase": "not-selected", "code": 0}
}
```

Native errors replace stale ready receipts with `nativeReady: false`,
`phase: native-bootstrap-failed`, code and error details.

Integrate on Windows before source/MCP initialization:

1. Honor the user's existing shared bundled/system preference first. Installer
   mode is only a first-install default; it must not overwrite an existing preference.
2. Re-probe receipt paths; a receipt is not a trusted executable resolver. For
   bundled mode, add private-cache paths as a bundled fallback, not as a system
   executable or as fake managed toolchain state. For system mode, exclude this
   cache and all packaged tool bins. `auto` is explicitly system-first for these
   prerequisites; do not silently reinterpret it as bundled-first.
3. Resolve gh/git/node/jq/yq to explicit executable paths and make their parent
   directories available to child processes. Keep managed toolchain precedence
   and native `.cmd` launch handling in the existing shared resolver. Preserve
   unrelated PATH entries; don't replace PATH with the receipt list.
4. Continue resolving packaged Bun/uv from existing resources. Bootstrap does
   not duplicate OMP/npm/Python installs; shared `ensureAll` owns those. The Node
   archive contains npm/npx alongside node.exe. Node system probes require
   >=22.23.0, covering the current core CLI engine requirements.
5. If startup recovery is needed, invoke the packaged PowerShell script in
   **64-bit** Windows PowerShell with argv boundaries, a bounded timeout and the
   selected mode. Never pass `-InstallLinuxSupport` automatically at startup.
   Surface exit 1 (native bootstrap failure), 2 (missing system dependencies),
   3 (optional WSL failure), and 3010 (restart needed). NSIS normalizes failures
   to exit 2 and preserves restart-required as 3010. Read the receipt for details.

Implemented in `packages/shared/src/toolchain/windows-bootstrap.ts` and
`apps/electron/src/main/windows-bootstrap.ts`, called from main startup before
backend/source/MCP initialization. The optional config field
`toolchain.dependencyMode` (`auto | bundled | system`) wins over the receipt;
startup never writes this preference or overwrites `toolchain.disabled`.
This checkout previously had no native dependency-mode config field.

The reader ignores receipt `pathEntries`, reconstructs current pinned private
paths from the shared manifest, rejects path/junction escapes, and probes native
executables with bounded `--version` calls. System candidates are rediscovered
from absolute PATH directories; private, packaged and managed prerequisite bins
cannot masquerade as system tools. npm/npx resolve beside the selected Node.

The resolver and manager share this native policy for the five prerequisites.
`auto` remains system-first; usable managed tools retain precedence over the
pinned private bundled fallback; `system`
never falls back to it. `ensureAll`/prerequisite `update` do not download duplicates or forge
managed state for installer files. Other managed tools retain precedence, and
child PATH filtering preserves unrelated entries, packaged Bun/uv and vendored
rg. Windows packaged Bun now uses its actual extraResources location.
An explicit OpenClaw installation retains its separate exact-managed-Node
contract and provisions that pinned managed Node when needed; it never aliases
installer/system Node into an OpenClaw launcher.

Packaged startup can repair native prerequisites using the shipped 64-bit
PowerShell script (120-second deadline, argv invocation). It does not select
WSL or Git Bash automatically. Exit codes and missing-tool names are logged as
non-secret structured diagnostics; raw receipt/process errors are not logged.
Optional private Bash is revalidated, exposed to the resolver/child PATH, and
published as `CLAUDE_CODE_GIT_BASH_PATH` only when neither user config nor an
explicit environment setting has selected Bash. Invalid saved Bash preferences
are retained for repair rather than deleted.

## WSL lifecycle

WSL is unchecked by default and is never needed for native Windows runtime/MCP.
Selection checks Windows build >=19041 and existing WSL first. Only OS-feature
enablement is elevated via UAC (`enable-wsl.ps1`); DISM uses `/NoRestart`.
The worker installs WSL without a distribution. On exit 3010/1641, provisioning
stops and returns `reboot-required`/3010. The installer never invokes reboot,
registers a RunOnce task, or enables optional Linux tools during silent upgrades.

Ubuntu registration runs in the original, unelevated user's context with
`--no-launch` after setting the user's default WSL version to 2; existing Ubuntu
is reused. An existing WSL1 Ubuntu is reported as `existing-wsl1-distribution`
and is never implicitly converted. The result is `user-setup-required`,
**not Linux runtime ready**. Open Ubuntu to complete its first-user setup, then
install the particular Linux helpers required by the selected feature. Windows
CLI installs do not become Linux CLI installs. No Windows credentials are copied.

After a reboot, explicitly resume from a normal user's 64-bit terminal:

```powershell
& "$InstallDir\resources\windows-bootstrap\bootstrap.ps1" -Mode auto -InstallLinuxSupport
wsl.exe -d Ubuntu
```

UAC cancellation, unsupported OS, Windows-feature failures and distro download
failures are recorded separately; native tools remain available. A host that
blocks virtualization/Store/network may require its administrator to finish WSL.
There is no automatic reboot or machine change in the validation suite.

## Audit findings and validation

- Previous NSIS configuration was one-click with no prerequisite hook or
  dependency selection. Native payload delivery now supports direct EXE installs
  as well as the download helper.
- The download helper now forwards native/WSL selection, accepts standard
  electron-builder manifests without an `arch` field, handles restart-required
  exit 3010, and points its app launcher at Rox's installation path.
- `scripts/build/common.ts:downloadBun` previously used `unzip` on Windows;
  it now uses native PowerShell `Expand-Archive` on Windows build hosts.
- `MANIFEST_DATA.git` is **MinGit busybox**, not Git Bash. The separate optional
  PortableGit payload covers Claude SDK Bash and shell-script skills natively.
  Existing `CLAUDE_CODE_GIT_BASH_PATH`/`gitBashPath` selections remain authoritative;
  neither MinGit nor WSL is treated as native Bash.
- Packaged document wrappers already have `.cmd` versions; Python/uv tooling is
  native-capable. Shell-based deploy/wizard skills under resources require Bash.
  Docker/Homebrew/craft-native and arbitrary Linux-only helpers are optional,
  not native installer prerequisites. WSL does not make macOS-only tools work.
- Bun packaging used 1.3.9 while the current OMP lock requires >=1.3.14. Bun and
  uv package pins now match the shared manifest (1.3.14 / 0.12.2).

```powershell
bun test scripts/build/__tests__/windows-dependencies.test.ts
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-windows-bootstrap.ps1 -TempRoot "$env:TEMP\opencode"
# Optional download-enabled checks; tools and output stay in the supplied temp directory.
bun scripts/test-windows-nsis.ts --temp-root "$env:TEMP\opencode" --download
bun scripts/validate-windows-dependencies.ts --temp-root "$env:TEMP\opencode"
bun test scripts/build/__tests__/windows-release.test.ts
bun scripts/test-windows-workgraph-packaging.ts --temp-root "$env:TEMP\opencode"
bun scripts/verify-windows-release.ts apps/electron/release/win-unpacked apps/electron/release/Rox-development-x64.exe
```

The PowerShell suite compiles a tiny --version-only CLI fixture and checks real
ZIP/raw extraction, path quoting/traversal, hash rejection, system/bundled modes,
idempotence, cache repair, entrypoint receipts and read-only inspection. WSL/UAC
boundaries are mocked before exercising privilege/reboot/cancellation/distro
branches. Real administrator/WSL/reboot acceptance needs a disposable Windows VM.
The NSIS checker uses electron-builder's pinned compiler/digest and compiles the
installer and uninstaller include branches with warnings as errors. It never
executes either generated installer.

The download-enabled validator now consumes the real receipt with the shared
reader/resolver, launches native node/npx/Bash children, and connects real
node/npx stdio MCP pool children with npm offline and isolated config/cache/HOME.
Full verification details: `packages/shared/src/toolchain/WINDOWS-BOOTSTRAP-INTEGRATION-20261003.md`.

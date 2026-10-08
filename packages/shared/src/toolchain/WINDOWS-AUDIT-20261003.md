# Windows toolchain audit — coordinator handoff

Branch: `fix/windows-runtime-mcp-bootstrap-20261003`.
Scope: `packages/shared/src/toolchain*` and `packages/shared/src/toolchain/**`.
Read root `AGENTS.md` and shared-package instructions. No commits. Runtime
verification used temporary configurations only; no real toolchain state,
global installs, user PATH, credentials, Python registry entries, or user-wide
Python launchers were changed.

## Confirmed issues and implemented fixes

1. **uv Windows artifact layout was wrong.** Downloaded the exact 0.12.2 ZIP:
   its SHA-256 and size match the catalog, but it contains root-level `uv.exe`,
   `uvw.exe`, and `uvx.exe`, not `uv-x86_64-pc-windows-msvc/uv.exe`.
   Corrected the path and exposed `uvx`; also exposed the companion `uvx` in
   the existing Unix layouts and `npm` alongside catalog Node/npx.
2. **npm installation failed under Electron's plain Node.** Reproduced
   `spawn npm.cmd` with `shell:false` as `EINVAL` in Node 22.23.1. Windows npm
   installation now invokes the sibling `node.exe` with
   `node_modules/npm/bin/npm-cli.js`, preserving argv without shell parsing.
   The existing lock and lifecycle-script policy is retained.
3. **Managed Python's Windows junction targeted the wrong directory.** A
   relative junction target was resolved against the host cwd. It now uses
   the absolute CPython directory within the managed version. Added
   `--no-bin --no-registry --no-config` and a toolchain-local cache directory
   to keep uv installation private rather than publishing user-wide Python.
4. **Windows PATH handling could lose `Path`.** Shared PATH prefixing now
   preserves the existing case-insensitive key and removes duplicate variants
   in the child env. Runtime, npm installation, and git-npm installation use
   this helper. Windows search uses semicolon separation, unquotes quoted
   entries, and recognizes `.exe`, `.com`, `.cmd`, and `.bat`.
5. **Resolver accepted directories and wrong companion programs.** Requires
   a regular executable file; rejects Unix extensionless managed wrappers on
   Windows. Resolving missing `node` no longer returns `npx.cmd`. Catalog
   aliases still work, and managed Windows Python resolves `python3` before
   a system alias.
6. **Generated pip/git-npm launchers were invisible.** Those entries have no
   downloaded artifact/binPaths; their installed `current/bin` launchers are
   now included in resolution and subprocess PATH.
7. **gbrain depended on bare system Git despite managed MinGit.** Declares
   `dependsOn: ['bun', 'git']`; the manager resolves Git and passes the exact
   executable into checkout. Both managed Git and Bun directories are added
   to checkout/install subprocess PATH.
8. **Broken installed versions remained permanently “ready”.** Status and
   planning now verify declared executables in both the version directory and
   `current`. Previously broken uv/Python installations are scheduled for
   repair on the next `ensureAll`, without this audit modifying live state.
9. **The existing test suite had Windows-only false failures.** Corrected
   native path expectations, resolver fixture platform/extensions, and hashing
   of a text fixture whose checkout bytes can differ under CRLF. Tamper and
   downloaded-artifact integrity checks remain independently exercised.

## Exact tools and requirements

These are **installation tiers**, not a claim that every core utility is a
prerequisite for every chat request.

### Always installed by the current core policy

| Catalog tool | Pin | Role / native Windows command |
| --- | --- | --- |
| omp | 17.2.10 | Default agent runtime; managed `omp.cmd` |
| node | 22.23.2 | npm installation, JS/MCP runtimes; `node.exe`, `npm.cmd`, `npx.cmd` |
| bun | 1.3.14 | OMP/npm wrappers, application subprocesses; `bun.exe` |
| uv | 0.12.2 | Managed Python, Python MCP runners; `uv.exe`, `uvx.exe` |
| python | 3.12 | uv-managed CPython; actual smoke install was 3.12.13 |
| git | 2.55.0.3 | Managed MinGit `cmd/git.exe`; Git workflows and git-npm checkout |
| gh | 2.97.0 | GitHub workflows; `bin/gh.exe` |
| ffmpeg | 9.0 catalog label; Windows build 9.0.2 | Media workflows; verified BtbN Windows archive (see continuation) |
| pandoc | 3.10.1 | Document conversion |
| jq | 1.8.1 | JSON command-line processing |
| yq | 4.53.3 | YAML command-line processing |

The default OMP installation directly depends on **Bun + Node/npm**. Python
installation depends on **uv**. git-npm installation depends on **Bun + Git**.
Windows archive extraction uses OS **PowerShell 5.1** for ZIP and OS **tar.exe**
for tarballs; no WSL is used by the toolchain installer.

### Default-on, disableable tools (nine)

`just`, `fzf`, `mise`, `worktrunk` (CLI `wt`), `opencode-ai` (CLI `opencode`),
`oh-my-codex` (CLI `omx`), `oh-my-claude-sisyphus` (CLI `omc`), `skills`, `gbrain`.
They are not prerequisites for the native Windows core runtime.

### Windows opt-in tools (twelve)

`infisical`, `openclaw`, `eve`, `agent-browser`, `portless`, `just-bash`,
`opensrc`, `deepsec`, `dev3000`, `docker`, `pip-packaging`, `cli-anything`.
Docker is detection-only: provisioning Docker Desktop/Engine is external.
OpenClaw keeps its exact managed Node + `openclaw.mjs` launch path and remains
excluded from generic executable resolution/PATH.

`brew`, `mole`, and `craft-native` have no native Windows catalog support.
Running Unix-only functionality in a separately provisioned WSL environment
is an optional feature-specific choice, not an application-wide requirement.

## Cross-owner dependencies / coordinator actions

- **Installer/packaging owner:** ripgrep (`rg.exe`) is separately bundled via
  `@vscode/ripgrep` in `apps/electron/electron-builder.yml`; it is not a toolchain
  catalog tool. The packaging/spawn integration must expose its directory to
  commands that need bare `rg`. The resolver intentionally does not know the
  Electron resources layout.
- **Installer/shell owner:** full **Git Bash** is required for the current
  Windows host Bash contract and Claude SDK Bash support. Managed **MinGit is
  not a full Git Bash distribution**. Native PowerShell/cmd exist without WSL,
  but do not replace Bash for a tool whose contract is Bash syntax. Honor
  `CLAUDE_CODE_GIT_BASH_PATH` / configured Git Bash and detect Git's `bin`
  beside a PATH entry for `Git/cmd`; do not treat WSL's system launcher as
  native Bash. The parallel host-Bash owner's current implementation follows
  this native-Bash selection contract.
- **OMP spawning owner:** managed `omp` still resolves to a `.cmd` wrapper.
  An executable path alone is not directly spawnable by plain Node on Windows.
  Resolve/launch that wrapper appropriately or invoke Bun + package JS directly;
  propagate `withToolchainPathPrefix` and preserve inherited Windows env keys.
  This change fixes npm installation's `.cmd` problem, not OMP spawning.
- **MCP bootstrap owner:** `npm`/`npx` and `uvx` now resolve from the managed
  toolchain. Windows `npx.cmd` still requires a launch adapter or Node + its JS
  entrypoint when a plain Node host spawns it. Use native commands unless an
  individual MCP actually needs Unix-only software.
- **Coordinator:** shared-package `tsc --noEmit` remains blocked by errors in
  `core/src/rox2/meeting-conation-shell.ts`, agent context-budget tests,
  meeting-agents tests, voice adapters/runtime, and workflows canvas tests.
  No diagnostics were emitted for the owned toolchain paths.

## Read-only host inventory (2026-10-03)

| Tool | Actual inventory |
| --- | --- |
| Git | 2.55.0.windows.3; `C:\Program Files\Git\cmd\git.exe` |
| Node/npm/npx | Node 22.23.1; `C:\Users\user\AppData\Local\hermes\node` |
| Bun | 1.3.14; `C:\Users\user\.bun\bin\bun.exe` |
| uv/uvx | uv 0.11.30; `C:\Users\user\AppData\Local\hermes\bin` |
| rg | 15.2.0; WinGet link directory |
| FFmpeg/ffprobe | FFmpeg 8.1.2; WinGet link directory |
| omp | `C:\Users\user\.bun\bin\omp.exe`; existence captured, runtime not exercised |
| Python/python3 | WindowsApps aliases only in command lookup; this does not prove a working interpreter |
| Git Bash | Bash 5.3.15; `C:\Program Files\Git\bin\bash.exe`, works by exact path but absent from PATH lookup |
| PowerShell/cmd/tar | Native Windows OS executables present |
| gh/jq/yq/py/pwsh | Missing from PATH lookup |
| WSL | `wsl.exe` exists, but `wsl --status` reports the subsystem is not installed |

## Initial-round verification

- `bun test packages/shared/src/toolchain`: **82 pass, 0 fail**, 1,384 assertions,
  ten files, on native Windows Bun 1.3.14.
- Plain Node integration regression test bundles the real installer for Node,
  executes it with native Node, and runs a local fake npm CLI via a copied
  sibling Node under paths containing spaces and `&`. No network/global npm
  operation is performed by this test.
- Isolated real-artifact smoke check verified SHA-256 and sizes of both pinned
  Windows archives, installed them under a temporary `isolated & space config`,
  resolved and successfully executed **gh 2.97.0, uv 0.12.2, uvx 0.12.2**, then
  used the real manager to install and run **CPython 3.12.13**. The resolved
  Python realpath was inside the temporary managed version. Temporary install
  state/cache was removed after the check.
- uv ZIP: 18,977,266 bytes; SHA-256
  `01442d8ce5c7124151a73e697c836d252c6da853c18c73206d3cc4c2378a91d2`.
- gh ZIP: 14,938,517 bytes; SHA-256 verified against catalog
  `35d7fe05c4dd1411ffda1e73dfc7c6f44b75c936ca51fa6595c657fdc0350cec`;
  its existing `bin/gh.exe` layout is correct.
- `git diff --check` for owned paths: passed (only Git LF/CRLF notices).
- `bun run tsc --noEmit` in `packages/shared`: fails outside owned paths as
  listed above. Full packaged first-run/OMP/MCP validation belongs to the
  corresponding owners; other catalog artifacts were not all redownloaded.

## Continuation: generated readiness and FFmpeg (2026-10-03)

### Directory-only generated installs were a confirmed readiness bug

The earlier `hasInstalledFiles` implementation used an empty-array `every`
for git-npm/pip entries. Existing version/current directories therefore meant
“ready” even when `resolver.findExecutable` returned null. The existing gbrain
tests also mocked this invalid directory-only install as success.

Implemented in `manager.ts`:

- git-npm readiness requires the expected `systemBinary ?? name` launcher in
  **both** the installed version and `current`; arbitrary other bin files do
  not count.
- pip console entries require that same launcher check and a `py_packages`
  directory in both layouts. Library-only pip entries deliberately require
  the package directory without inventing a console executable.
- Windows requires a `.exe`, `.com`, `.cmd`, or `.bat` launcher; the generated
  Unix shell wrapper alone is insufficient. POSIX requires executable access.
- git-npm and pip installs cannot emit/persist ready after an incomplete
  generated install. Missing default-on gbrain launchers are repaired by
  `ensureAll`; pip stays opt-in and repairs through explicit `update(name)`.
- Artifact-backed entries with no declared executables fail readiness rather
  than passing vacuously.

Regressions cover directory-only installs, unrelated binaries, version/current
copy disagreement, directories pretending to be files, Windows Unix-wrapper
rejection, gbrain repair/idempotency, pip explicit repair, package-directory
removal, and incomplete-install status emissions. POSIX execute-permission
coverage is present but skipped on the native Windows runner.

### The old Windows FFmpeg pin really is unavailable

Direct request to the original Windows URL returned **HTTP 404**:

`https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-06-13-39/ffmpeg-N-125978-g95c43d7df7-win64-lgpl.zip`

The initial audit checked the system FFmpeg and uv/gh/Python smoke, not this
managed media download. System FFmpeg 8.1.2 was resolvable on PATH but does not
make the pinned managed download valid: FFmpeg is not one of the receipt's
five bootstrap prerequisites. This continuation takes the verified-pin repair
route without expanding or changing the completed dependency-mode policy.

Updated **only the Windows artifact** to the available LGPL/static 9.0-series
release:

- Release: `autobuild-2026-09-30-13-08`.
- Asset: `ffmpeg-n9.0.2-17-g2a571b6068-win64-lgpl-9.0.zip`.
- URL: `https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08/ffmpeg-n9.0.2-17-g2a571b6068-win64-lgpl-9.0.zip`.
- Downloaded size: **171,535,354 bytes**.
- Downloaded SHA-256: **`6b264b9e6019103f601d98c292bd332fd87acf1c5e941ddff4fb71760fe63432`**.
- Matched both GitHub asset metadata and the release's published
  `checksums.sha256`.
- Verified ZIP layout and managed executable path:
  `ffmpeg-n9.0.2-17-g2a571b6068-win64-lgpl-9.0/bin/ffmpeg.exe`.

Unix artifact URLs/checksums/sizes/layouts and the shared `9.0` version label
were retained. The media entry no longer declares itself critical to chat;
its current core installation tier is retained. An isolated regression forces
FFmpeg HTTP 404 while installing OMP and proves that OMP remains ready and
resolvable. The production app-top banner tracks `omp` specifically, and OMP's
runtime resolution does not gate on FFmpeg.

### Latest verification (supersedes the earlier typecheck status)

- `bun test --timeout 20000 packages/shared/src/toolchain`: **105 pass,
  1 skip, 0 fail**, 1,471 assertions, twelve files. The skipped check requires
  POSIX filesystem execute-permission semantics. The extended timeout avoids
  Windows archive-extraction fixture timing failures under concurrent I/O.
- Native installer-startup and OMP Windows launch integration tests:
  **16 pass, 0 fail**, 81 assertions. Completed bootstrap/source selection
  integration and its test coverage were preserved.
- `bun run tsc --noEmit` in `packages/shared`: **passed** in the current shared
  working tree after the parallel owners' fixes.
- Real SHA-verified FFmpeg archive installed with `installTool` under a temporary
  path containing spaces and `&`. Real manager `ensureAll` reused the completed
  install without a download and returned ready; resolver selected its exact
  managed binary. Native `-version` reported
  `n9.0.2-17-g2a571b6068-20260930`, and a sine-to-PCM conversion created an
  **8,898-byte WAV**. Temporary config/state/media files were removed afterward.
- Owned-path `git diff --check`: passed (Git line-ending notices only).
- No commits or real user toolchain/config/global dependency changes.

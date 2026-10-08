# Native installer → runtime integration evidence (2026-10-03)

Branch: `fix/windows-runtime-mcp-bootstrap-20261003`.
Existing agent changes were retained; this continuation used targeted patches.

## Integration ownership/files

- New shared reader/policy: `windows-bootstrap.ts` in this directory.
- New full PortableGit vendor pin: `windows-git-bash-pin.ts` in this directory.
- Resolver/manager consume the same policy; installer files never become fake
  managed state. Auto/system selection takes precedence over managed prerequisite
  copies when a system tool is selected; managed tools retain precedence over
  bundled installer fallbacks. Unrelated managed tools retain precedence.
  Explicit OpenClaw install keeps its exact managed Node contract and provisions
  that separate pinned Node only when required by the opt-in installation.
- `packages/shared/src/toolchain-runtime.ts` filters private prerequisite paths
  before adding the current resolver prefix to agent/MCP environments.
- `packages/shared/src/config/{storage,validators}.ts`: optional read-only
  `toolchain.dependencyMode` preference. No startup preference persistence.
- `apps/electron/src/main/{windows-bootstrap,index}.ts`: startup ordering,
  bounded 64-bit native recovery, PATH casing, actual packaged Bun location,
  retained Git Bash config, optional installer Bash handoff.
- `scripts/stage-windows-dependencies.ts`: includes pinned optional PortableGit.
- `apps/electron/build/windows/{bootstrap.ps1,dependency-functions.ps1,installer.nsh}`:
  explicit native Git Bash provisioning/receipt/NSIS option.
- `scripts/install-app.ps1`: forwards `-InstallGitBash` as `/GITBASH`.

## Verified checks

### Regression/unit/native-child tests

```powershell
bun test packages/shared/src/toolchain/__tests__/windows-bootstrap.test.ts apps/electron/src/main/__tests__/windows-bootstrap.test.ts packages/shared/src/toolchain/__tests__/resolver.test.ts packages/shared/src/toolchain/__tests__/manager.test.ts packages/shared/src/toolchain/__tests__/exec.test.ts packages/shared/src/toolchain/__tests__/openclaw.test.ts packages/shared/src/mcp/__tests__/mcp-pool-transport.test.ts packages/shared/src/agent/__tests__/omp-windows-launch.test.ts scripts/build/__tests__/windows-dependencies.test.ts
```

**75 passed / 0 failed** on native Windows, Bun 1.3.14.
Coverage includes BOM/failed/invalid receipts, pin/path validation, junction
escapes, deleted executables, system-first auto, explicit system preference,
private/packaged exclusion, retained rg/managed PATH, npm/npx companions,
no duplicate downloads/state writes, recovery exit 1/2/3/3010, explicit Bash
precedence and a compiled native PE fixture child.

### Native installer fixture suite

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-windows-bootstrap.ps1 -TempRoot "C:\Users\user\AppData\Local\Temp\opencode"
```

**40 checks passed**, including parsing shipped PowerShell, ZIP/raw extraction,
hash rejection, cache repair, receipts, inspection and mocked WSL boundaries.

### NSIS include compilation

```powershell
bun scripts/test-windows-nsis.ts --temp-root "C:\Users\user\AppData\Local\Temp\opencode" --download
```

**Installer + uninstaller compile passed with warnings as errors.** The optional
native Bash checkbox and `/GITBASH` forwarding compile. Neither EXE was executed.

### Real pinned release / runtime / MCP smoke

```powershell
bun scripts/validate-windows-dependencies.ts --temp-root "C:\Users\user\AppData\Local\Temp\opencode"
```

**Passed** with real SHA-256/size-verified gh 2.97.0, MinGit 2.55.0.3,
Node 22.23.2, jq 1.8.1, yq 4.53.3 and full PortableGit 2.55.0.3.
Also verified packaged Bun 1.3.14 and uv 0.12.2.

The validator provisions only its temporary `LOCALAPPDATA`-shaped tree, verifies
second-run reuse, consumes the installer receipt using the production reader,
resolves explicit executable paths, launches native node/npx/Bash, and connects
real shared MCP pool children through bare `node` and `npx`. The MCP tool response
proves both children used the receipt-selected Node executable. npm runs offline;
config/cache/HOME are isolated. No global installation/authentication, WSL,
elevation, reboot or real user-config write is involved.

PortableGit vendor evidence:
`https://github.com/git-for-windows/git/releases/tag/v2.55.0.windows.3`

- Asset: `PortableGit-2.55.0.3-64-bit.7z.exe`
- Size: `58919776`
- SHA-256: `ab00566336b5472120f9a52d34f2e79c5406535792acb0548001ffd0bd090e5d`
- Published release checksum matched the downloaded payload, then native Bash
  execution and required DLL/full Git files were checked in the temporary cache.

## Typecheck status / limits

`bun run tsc --noEmit` was run in both `packages/shared` and `apps/electron`.
Both remain blocked by unrelated existing diagnostics, including:

- `packages/core/src/rox2/meeting-conation-shell.ts:29`
- shared context-budget, meeting-agents, workflows tests and voice runtime
- Electron meetings navigation/Rox2 tests, automation graph and renderer types
- server-core labels/messaging/meetings types

The latest checks reported no diagnostics in the new bootstrap integration files
or the changed toolchain/config/startup integration paths. A green whole-package
typecheck is **not** claimed.

`git diff --check` passed (line-ending warnings only). No commit was made.
Live packaged Electron/NSIS GUI installation was not run because it would write
the real user profile; the native entrypoint/runtime/MCP path was exercised in
the isolated release smoke instead. WSL is not a substitute for native Bash.

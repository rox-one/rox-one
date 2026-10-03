# Windows installer/release validation — 2026-10-03

## Generated development artifact

- Path: `apps/electron/release/Rox-development-x64.exe`
- Version: `0.11.5`
- Size: `392476536` bytes (approximately 374.3 MiB)
- SHA256: `f2a418ae03cee70b09013fd85949dec3722313e971ee06d56507e507ba95c251`
- Packaged metadata: `roxWindowsBuild: optional-development`
- OEM mode: explicitly optional; vendor payload unavailable
- Completed installer execution: **not performed**

Process inspection found no active release/main build before each build attempt.
Full development compilation ran with a larger timeout and without simultaneous
tests: main, workers, preload, renderer and resources completed. Packaging was
then resumed against those outputs after resolving the failures below. The real
NSIS target completed and emitted the installer and blockmap.

## Final current-source main refresh

After review identified that the prior main bundle predated the final
`toolchain-runtime.ts` change, main was rebuilt from current sources using
`scripts/electron-build-main.ts --main-only`, then the development NSIS installer
was repackaged. No worker, preload, renderer or resource builds were rerun for
this refresh. Process inspection found no active build; no other apps were stopped.
No application/build source changes were needed for this refresh.

- Main size: `53807861` bytes
- Main SHA256: `2e9da19ff37cda30e6b2f43610c3c4100233857b62b7d74f8c376a5062a55664`
- Current `packages/shared/src/toolchain-runtime.ts` SHA256:
  `900b293a1bd1a3b9626f901f7846b922bd5c7f6800d18a637c2908b63be9d08e`
- The rebuilt `dist/main.cjs`, `win-unpacked/resources/app/dist/main.cjs`, and
  `resources/app/dist/main.cjs` extracted directly from the final installer
  have identical bytes/hashes.

The actual function body in all three copies contains:

```js
async function createHostBashEnv(baseEnv = process.env, resolver = getToolchain().resolver) {
  const env2 = await withToolchainPathPrefix({ ...baseEnv }, resolver);
  delete env2.CRAFT_HOST_BASH_PYTHON;
  if (process.platform === "win32") {
    env2.ORIGINAL_PATH = env2[pathEnvKey(env2)] ?? "";
    const python = await resolver.findExecutable("python3");
    if (python) {
      const withinManaged = (0, import_node_path45.relative)(resolver.toolchainDir(), python);
      if (withinManaged && withinManaged !== ".." && !withinManaged.startsWith(`..${import_node_path45.sep}`) && !(0, import_node_path45.isAbsolute)(withinManaged)) {
        env2.CRAFT_HOST_BASH_PYTHON = python.replace(/\\/g, "/");
        env2.UV_PYTHON = python;
      }
    }
  }
  return env2;
}
```

This was verified as an assignment AST inside the Windows-guarded
`createHostBashEnv` function, not a marker elsewhere. The exact installer-extracted
function was also evaluated in an isolated VM with stubbed environment/resolver
dependencies: `Path`, `PATH`, and missing-path cases all passed; the prepared
child path is assigned before Python resolution, and the parent environment
remains unchanged. Neither the app main module nor the installer was executed.

The session-only verification harness is
`C:\Users\user\AppData\Local\Temp\opencode\verify-final-host-bash-20261003.mjs`.
It extracts only `main.cjs` with the existing 7za tool and removes its scratch
extraction directory afterward. `verify-windows-release.ts` was rerun against
the final artifact and passed all package, pin-hash and in-memory NAPI checks.

## Packaging failures found and fixed

1. **Development environment lost between processes:** on this Bun/Windows
   runtime, `execFileSync` without an explicit `env` inherited the original OS
   environment instead of the modified `process.env`. Release children and
   packaging-hook children now receive an explicit snapshot. A real child-process
   regression verifies both development flags arrive.
2. **Unsigned development executable editing required symlink privileges:**
   winCodeSign's tool archive failed extracting its macOS symlinks. Explicit
   OEM-optional development builds disable signing/resource editing, retaining
   production policy and avoiding elevation/machine configuration changes.
3. **Negative-only Windows file matcher copied source/build folders:** shared
   normalized FileSets and `win.files` strings created separate matchers. One
   merged allowlist now applies the Windows exclusions correctly. File settings
   are restored by the afterPack wrapper, which retains the existing macOS hook.
   Immutable dependency payloads are excluded from re-signing.
4. **StdUtils plugin lookup happened too early:** custom page function bodies
   were compiled while processing the include, before builder's plugin-directory
   setup. They are now emitted inside `customPageAfterChangeDir`.

## Launcher regression fix

The downloader writes a fixed ASCII `.cmd` wrapper and a UTF-8 PowerShell helper.
The helper resolves NSIS `InstallLocation` from the exact app GUID on every
invocation, prioritizing HKCU and using registry-view fallbacks. Legacy
`Programs\@craft-agentelectron` and custom Unicode paths are supported.

Registry values never become shell source. Only a validated absolute directory
plus `Rox.exe` is launched, using `ProcessStartInfo` with `UseShellExecute=false`
and explicit Windows argv quoting. No `UninstallString` command is consumed.

Fixture coverage includes fresh registration, upgraded legacy registration,
custom Unicode/apostrophe/ampersand/percent paths, stale-view fallback, per-user
precedence, invalid command-shaped paths, and spaced/metacharacter/empty/quoted/
trailing-backslash arguments. Registry readers are injected for install-location
fixtures; no installation keys or live profiles are modified.

## Checks

Latest main refresh and repackaging commands (from repo root, except builder):

```powershell
$env:ROX_WINDOWS_DEV_WITHOUT_OEM = '1'
$env:CRAFT_DEV_RUNTIME = '1'
bun run scripts/electron-build-main.ts --main-only
# PASS: current-source main compiled and syntax-verified; no worker builds.

# From apps/electron:
bun run electron-builder --config electron-builder.yml --win --x64 --publish never
# PASS: beforePack payload gates/staging and final development NSIS packaging.

# From repo root:
bun scripts/verify-windows-release.ts apps/electron/release/win-unpacked apps/electron/release/Rox-development-x64.exe
# PASS against the final checksum/size above.
```

Earlier same-session regression checks:

```powershell
bun test scripts/build/__tests__/windows-release.test.ts scripts/build/__tests__/windows-dependencies.test.ts scripts/build/__tests__/stage-servers.test.ts
# 20 passed, 0 failed

powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-windows-bootstrap.ps1 -TempRoot "$env:TEMP\opencode"
# 59 checks passed

bun scripts/test-windows-nsis.ts --temp-root "$env:TEMP\opencode" --nsis-dir <cached-nsis-directory>
# Installer/uninstaller include branches compile with warnings as errors.

bun scripts/verify-windows-release.ts apps/electron/release/win-unpacked apps/electron/release/Rox-development-x64.exe
# PASS: metadata, main syntax, runtime files, no source/duplicate runtime tree,
# Bun/uv versions, all 6 dependency payload sizes/hashes, in-memory WorkGraph NAPI.
```

Production remains correctly blocked until the real Windows OEM kernel and its
runtime assets are supplied. No vendor binary was fabricated. No finished installer,
Rox startup, WSL provisioning, elevation or reboot was executed during validation.

# Local Mac arm64 Pocket SSO candidate — 0.11.8

Local packaging and native Keychain persistence verification passed for exact source `aa80de1b44d12a3fbbf425ce5aca8709617972ca`. This is a locally ad-hoc-signed staged candidate. Developer ID signing, notarization, publication, GUI first launch, Pocket login and provider canary remain pending or excluded from this task.

## Source and isolation

The detached checkout is `/tmp/rox-pocket-mac-package-aa80-20261004` (canonical filesystem path `/private/tmp/rox-pocket-mac-package-aa80-20261004`). All tracked source remained clean. `source-binding.json` records the Git tree and byte-exact hashes of nine critical lock/build/store/probe files. The original dirty release checkout, unrelated launch worktrees, source UI and user ROX profiles were not used for execution.

Bun 1.3.14 ran `bun install --frozen-lockfile` successfully: 1824 packages, 194.72 seconds. Actual Electron 39.2.7 was installed with its native `dist` and `path.txt`. Node 22.23.3 came from `/opt/homebrew/opt/node@22/bin/node`. Preflight free disk was approximately 142 GiB. The build used a whitelisted environment: system identity/locale, pinned toolchain PATH, isolated `ROX_CONFIG_DIR`/`CRAFT_CONFIG_DIR`, `CSC_IDENTITY_AUTO_DISCOVERY=false`, and `NODE_OPTIONS=--max-old-space-size=4096`. No signing, Apple, OAuth or GitHub credential variables were passed; the scratch checkout had no `.env`.

## Canonical package result

`bun scripts/desktop-release.ts` completed exit 0 without product source edits or packaging overrides. It rebuilt subprocesses, main, preloads, renderer and assets; staged native SQLite, SDK, Bun, uv and server resources; then ran Electron Builder 26.4.0 for `dmg:arm64` and `zip:arm64`, `--publish never`.

Canonical checks passed: packaged main CJS syntax, native Turso SQLite `select 1`, packaged Bun `1.3.14`, uv `0.10.6`, Claude Code `2.1.258`, required resources, updater artifact metadata and GitHub feed `rox-one/rox-one`. The manifest is version `0.11.8`, platform `darwin`, arch `arm64`, commit `aa80de1b44d12a3fbbf425ce5aca8709617972ca`.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `Rox-arm64.dmg` | 347345914 | `031fefdc8c3bc3873d6878f0cae679bb8a40602080fab2cf0bc132ec984b78d1` |
| `Rox-arm64.zip` | 338417829 | `3916e3463c83ce4518d2bcf14fd668508c9e55d48e631a85b0f02964e375ffe0` |

Artifacts and the `.app` remain outside Git under `apps/electron/release/` in the detached checkout. `manifest-darwin-arm64.json`, updater YAML files and receipts are copied into this report directory.

Independent checks also passed: `unzip -tqq`, `hdiutil verify`, deep strict `codesign --verify`, actual arm64 Mach-O inspection of Rox/Bun/uv/Claude, framework `CFBundleVersion=39.2.7`, artifact SHA-256 readback and final tracked-source cleanliness. `package-verification.json` binds these checks and twelve critical packaged-file hashes. The packaged main CJS SHA-256 is `485198e45ef87ceab975162520bb516a706584aecbb2175627b22f69db60acdb`.

## Actual signature and attempt history

Electron Builder applied local ad-hoc signing (`identityName=-`, `identityHash=none`, no provisioning profile). Independent `codesign -dv --verbose=4` confirmed `Signature=adhoc` and `TeamIdentifier=not set`; deep strict integrity verification exited 0. No Developer ID or Apple signing credential was used; notarization was explicitly skipped and nothing was published.

The canonical manifest's `signed=false` means no configured `CSC_LINK` credential. It does not mean that the Apple Silicon bundle lacks a local ad-hoc signature. The first attempt was interrupted at the initial discovery of this default because the delegated “no signing” wording was initially interpreted too broadly. The lead clarified that build-required local ad-hoc signing was authorized; the untouched canonical build then completed in attempt 2. First-attempt outputs are retained only in the owned scratch `release-attempt1-interrupted` directory and are not the accepted candidate. Logs and `unsigned-boundary-recovery.json` retain this history.

The source icon hook rejected stale `Assets.car` provenance and used fallback `icon.icns`. Existing renderer warnings did not prevent the build. The independent harness was adapted for the host Python version (streaming SHA-256) and the framework's actual `CFBundleVersion` key; these were harness corrections without product edits.

## Native Keychain proof and its limits

The unchanged product Pocket account store was exercised in actual Electron 39.2.7 in separate write/read processes using only generated synthetic account/token fixtures. Both phases passed native encryption availability, account/logout/binding serialization, no plaintext secrets in store files, ciphertext readback, persisted readback after process restart and clearing. The probe directory was isolated and removed afterwards.

`native-keychain-receipt.json` records backend `Keychain`, `encryptionAvailable=true`, `profileIsolated=true`, both phases complete/passed, and readonly/writable fsync descriptors opened/flushed successfully. It retains projected diagnostics only, with no token, key or ciphertext contents.

Harness-only delta from `scripts/probes/pocket-vault-native.ts`: prohibited activation before app readiness, process-local `SecKeychainSetUserInteractionAllowed(false)`, assertions that activation policy is 2 and OSStatus is 0, unique probe app name, disabled hardware acceleration and absolute imports to the unchanged source modules. The native guard is an owned N-API addon compiled against Security/AppKit; its source and hashes are retained. There was no BrowserWindow, interactive Keychain fallback or foreground app launch. The Keychain API's deprecation warning is retained in `headless-guard-build.log`.

This proves native OS encryption and persistence across process restart for the source store on this host. It does not prove packaged Rox GUI first launch, SSO/OAuth completion, provider inference, updater installation or release acceptance. Those checks remain with the lead's canary and delivery gates.

## Settled execution

`cleanup-receipt.json` records all owned commands settled and no surviving known owned PIDs. An image device left by the interrupted first packaging attempt was detached successfully after final verification; no owned image remained attached. No unrelated mount or process was changed. The detached checkout and final binaries are retained for the lead's canary; no Git commit, push, merge or external deployment was performed by this worker.

# Independent review of native vault CI proof

Reviewed root-owned dirty addition at desktop checkout HEAD `6855bc4ffab55a5f35744ceea5761477d47174e8`; feature implementation source remains `354a483acc708d8130104e39525fdd0e8681058f`. Files: `scripts/probes/pocket-vault-native.ts`, `scripts/probes/run-pocket-vault-native.ts`, `.github/workflows/desktop-release.yml`. Reviewer did not edit these files or launch the actual vault proof.

Result: no unresolved actionable defect identified after root repaired the two strict type errors reported during this pass. Windows/Mac native acceptance and actual GUI/Pocket workflows remain pending their own execution; this review is source, bundle, type and runner-orchestration evidence.

## Findings and validation

- Initial targeted strict typecheck with `noUncheckedIndexedAccess=true` failed at `pocket-vault-native.ts:9` (possibly undefined phase passed to includes) and `run-pocket-vault-native.ts:12` (possibly undefined first build output). Root added explicit guards. Identical targeted typecheck then exited **0**. The new scripts are outside normal Electron `include`, so that passing targeted command is distinct from existing app typechecks.
- Actual probe CJS bundle compiled: 2 modules, 8.22 KB. Runner bundle compiled: 1 module, 2.0 KB. Neither bundle command executed Electron.
- YAML parses. All 8 new auth/ownership regression paths exist. Matrix includes `darwin/arm64` and `win32/x64`; native runner precedes artifact upload and native receipt JSON glob is included. Workflow retains contents-read permission, manual/release-branch triggers and packaging `--publish never`.
- Probe uses the actual `createPocketAccountStore`, real Electron safeStorage API, isolated temp userData/name and random synthetic account/tokens. It verifies encrypted account, pending logout and binding readback after a second process; checks clear account/logout readback. Only hashes of fixture objects leave the sealed store and success receipts expose phase/platform/Electron/backend metadata. No OAuth, provider/network call or normal ROX configuration access is in the probe source.
- Runner awaits both phases, drains stdout/stderr, kills a hung child after 30 seconds, rejects nonzero/missing receipt, writes metadata evidence only after both successes and removes temporary store/profile in finally. No shell-specific quoting is used in child argument arrays. Windows execution itself remains CI proof, not reviewer proof.

## Independent runner boundary probe

Preserved harness: `pocket-sso-desktop-recheck-evidence/pocket-native-runner-review.ts`. It copies only the runner into a disposable workspace, explicitly replaces its Electron dependency with a guarded fake Node executable, mocks bundle output, and shortens only the timeout-case timer from 30 seconds to 250 ms. It does not execute native store code and does not write the real native receipt path.

- Success path: exit 0, both phase receipts accepted, isolated receipt artifact present, 604 ms.
- Hung-child path: child killed, runner exit 1 with `native_probe_write_failed_137`, no receipt artifact, 298 ms.
- Temporary workspaces removed and no reviewer-owned child remained after completion.

Harness failure history: the first temporary-copy attempt used `mock.module('electron')`, which did not bind to that copy's module resolution. Bun resolved a cached Electron44 binary and ran the empty synthetic bundle until the runner timeout killed it. No vault/OAuth/window-creation code was in that bundle. This was a reviewer harness mistake, was reported immediately, and contributes no native proof. The corrected harness uses explicit dependency substitution and verifies the executable path before spawn; its results above are the runner evidence.

Final source SHA256:

```
ef06869bb06246151d83e272f8055846591d806cfb15b34e510690db36748973  scripts/probes/pocket-vault-native.ts
773dce1d85a45a016fb6652e39dc3f7f91fbf9f9211d15baa983cf1235c08635  scripts/probes/run-pocket-vault-native.ts
456037a3d1940d08ce23500fdb7392f6c14ae28c3e2f449ff685fc424cbd4ab4  .github/workflows/desktop-release.yml
```

# Bounded UI-001 qualification after runtime-map integration

The authorized local A/B/C1/C2/D scope passed on production base `c22ba7c690674cb0e806b6f11211d19063195410` plus the two corrected test fixtures at `f6dda1fd18e81c743f6955cf4d19ceba5666bd51`. No production file or historical qualification manifest changed. The actual incoming checkout-source policy is retained: tested bytes must match their Git checkout and stay stable; historical candidate drift is recorded literally.

| Phase | Actual scope | Result | Exit |
| --- | --- | --- | --- |
| A | terminal/cloud-run dispatch, route recovery, service-workspace recovery and read-only runtime-map selection | 29 pass, 232 Bun assertions | 0 |
| B | real mounted MainContentPanel, retry/lazy/resource/resize and browser storage callbacks | 11 pass, 23 Bun assertions | 0 |
| C1 | actual NavigationProvider, PanelSlot, MainContentPanel and AppShell message-loading effect under StrictMode | 17 scenarios pass | 0 |
| C2 | actual SourceInfoPage/SkillInfoPage, resource recovery, directory precedence, browser history and storage | 22 scenarios pass | 0 |
| D | actual mounted NavigationProvider, readiness, current/stale callbacks and raw URL history | 38 pass, 131 Bun assertions | 0 |

This is 117 passing cases: 78 Bun tests with 386 Bun assertions and 39 CLI browser scenarios. CLI assertions are not included in the Bun assertion count. The runs were serialized with a new owned screenshot destination; all browser/server fixtures closed and process readback found no remaining browser process. Bun was `1.3.14 (0d9b296a)` and actual isolated Chromium was `131.0.6778.33` at the qualified local `chromium_headless_shell-1148` path. No Node assertion adapter was needed.

## Source binding

`f6dda1fd1/source-before.json` and `source-after.json` prove all 24 pinned production paths, the fixture files and 197 actual extracted-bundle inputs stayed unchanged. All 73 tracked extracted-bundle inputs matched their Git checkout. Fresh Main/navigation bundles include the injected production MainContentPanel/AppShell functions in their input manifests.

`C1-component.manifest.json`, `C2-component.manifest.json` and `component-inputs-after.json` record actual component esbuild inputs. C1 has 1,869 persistent file inputs, including 67 tracked source inputs; C2 has 1,878 inputs, including 47 tracked source inputs. All tracked inputs match checkout; all input bytes remain stable after the mounted tests. Generated bootstrap and output bundle SHA-256 values are captured before the owned temporary directories are removed.

The historical candidate differs in exactly five paths: App, AppShell, MainContentPanel, NavigationContext and shared/types. `historical-source-manifest-v3.json` is a byte-preserved copy, and the original manifest remained unchanged. This evidence qualifies the tested checkout for this bounded scope; it does not rewrite or promote historical native proof.

## Fixture corrections and preserved failures

Only `rox-readiness-ui-001.browser.test.ts` and `rox-readiness-ui-001.component-harness.ts` changed. Corrections are commits `7ec867830`, `6c77f0845`, `56052f6f3`, `f80f3b3a9`, and `f6dda1fd1`.

- The source-extracted Main fixture now explicitly supplies the synchronous navigation readiness that its controlled session rows already represent. Mounted NavigationProvider behavior is separately exercised in C1/D.
- The deleted-session waiter retains entity `a` and follows the actual `route-session-missing` / `data-route-entity` contract. The existing assertions are preserved.
- The real entity fixture allows actual SourceStatusIndicator and deriveConnectionStatus to execute. It supplies the actual TooltipProvider and resolves the same production public tooltip exports directly, avoiding unrelated KaTeX assets from the broad UI barrel. Source health/authentication derivation is never fabricated.
- An optional `ROX_UI001_COMPONENT_MANIFEST` captures fresh component dependency evidence. Its default is unset; historical outputs are unchanged.

The preceding failures remain in separate directories: B at `c22ba7c690` failed before mounted assertions on an unbound readiness hook; B at `7ec867830` passed 10 cases and failed the obsolete deleted-session selector; C2 at `6c77f0845` failed bundling the intercepted status exports; C2 at `f80f3b3a9` failed bundling unrelated barrel font assets. These exit-1 results are not labeled passes. Production source hashes stayed stable; receipts that span the deliberate fixture correction record changed fixture bytes honestly.

## Commands and reproduction

Every phase has a JSON receipt containing exact argv, environment, cwd, start time, elapsed time, timeout and actual exit code, plus a raw log. `qualified-result.json` indexes the final results. `bounded-command-runner.py` and `collect-source.py` preserve the lightweight collectors. The existing committed bundle helper compiles immutable fixtures directly from the source test functions, recording actual inputs and bundle SHA-256 values.

Run from a checkout of the tested fixture revision, with the pinned Bun and qualified isolated browser. Use fresh output paths for each run:

```sh
UI001_BUN=/workspace/scratch/d0a9c1c6c094/tooling/node_modules/@oven/bun-linux-x64/bin/bun
UI001_CHROMIUM=/root/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell
UI001_HARNESS=docs/final-readiness/execution/cloud/OWNER-UI-001/verification/expanded/harness
UI001_OUT=/tmp/rox-ui001-current
mkdir -p "$UI001_OUT"
"$UI001_BUN" "$UI001_HARNESS/rox-readiness-ui-001.bundle-fixture.ts" navigation "$UI001_OUT/navigation-fixture.js"
"$UI001_BUN" "$UI001_HARNESS/rox-readiness-ui-001.bundle-fixture.ts" main "$UI001_OUT/main-fixture.js"
python3 docs/evidence/runtime-map/ui001-bounded/collect-source.py "$UI001_OUT" before "$UI001_OUT"
"$UI001_BUN" test --timeout 30000 ./apps/electron/src/renderer/components/app-shell/__tests__/terminal-cloudrun-hosts-nav.test.ts ./apps/electron/src/renderer/components/app-shell/__tests__/rox-readiness-ui-001.route-recovery.test.ts ./apps/electron/src/renderer/components/app-shell/__tests__/rox-readiness-ui-001.service-workspace-recovery.test.ts
ROX_UI001_BROWSER_TEST=1 ROX_UI001_CHROMIUM_EXECUTABLE="$UI001_CHROMIUM" ROX_UI001_MAIN_FIXTURE_BUNDLE="$UI001_OUT/main-fixture.js" ROX_UI001_EVIDENCE_DIR="$UI001_OUT/screens" "$UI001_BUN" test --timeout 60000 ./apps/electron/src/renderer/components/app-shell/__tests__/rox-readiness-ui-001.browser.test.ts
ROX_UI001_BROWSER_EXECUTABLE="$UI001_CHROMIUM" ROX_UI001_COMPONENT_MANIFEST="$UI001_OUT/C1-component.manifest.json" "$UI001_BUN" docs/final-readiness/execution/cloud/OWNER-UI-001/rox-readiness-ui-001.navigation-browser.ts
ROX_UI001_BROWSER_EXECUTABLE="$UI001_CHROMIUM" ROX_UI001_COMPONENT_MANIFEST="$UI001_OUT/C2-component.manifest.json" "$UI001_BUN" docs/final-readiness/execution/cloud/OWNER-UI-001/rox-readiness-ui-001.recovery-browser.ts
ROX_UI001_BROWSER_TEST=1 ROX_UI001_CHROMIUM_EXECUTABLE="$UI001_CHROMIUM" ROX_UI001_NAV_FIXTURE_BUNDLE="$UI001_OUT/navigation-fixture.js" "$UI001_BUN" test --timeout 60000 ./apps/electron/src/renderer/contexts/__tests__/rox-readiness-ui-001.navigation-browser.test.ts
python3 docs/evidence/runtime-map/ui001-bounded/collect-source.py "$UI001_OUT" after
```

## Limits

This is renderer and explicit IPC-boundary fixture proof. Runtime coverage in route fixtures is honestly unavailable; provider calls are forbidden. It does not claim full UI-001 workflow qualification, installed Windows/macOS or actual hosted acceptance. The full local `test:mcp-onboarding` command remains blocked because its ConfigWatcher starts the unrequested Context7 service; this qualification neither runs that command nor routes it into CI. Existing upstream checkout-source policy and native qualification requirements remain intact.

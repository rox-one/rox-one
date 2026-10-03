# UI-001 mounted renderer callback harness

These scripts run the existing navigation (24 cases) and MainContent (11 cases) test callbacks against immutable bundles of the production renderer code. Backend data and IPC are explicit fixtures. This lane proves mounted React/Jotai/history, route recovery, native browser storage events, reload, resize cancellation and current/stale callback behavior. It does not close installed Windows, installed macOS or hosted acceptance.

The original `bun test` lane remains in the source tests. On this host, qualified Bun 1.3.14 could bundle outside its test runner, but `bun:test` child-process calls returned exit 1 and empty stdout/stderr even for `/bin/echo`. esbuild failed before test execution. Bun Playwright CDP connections also timed out at WebSocket connection outside the test runner, with and without the interceptor auto-install flag. Node connected to the same healthy Chromium endpoint. These failures are preserved separately; the Node callback results are never reported as Bun test passes.

The adapter replaces only `bun:test` registration/assertion functions with Node assertions and sequential hooks. The actual source test callbacks, production fixture functions and assertions are compiled directly from the committed test files. The source tests retain their default Bun/Playwright execution path. `ROX_UI001_TEST_FILTER` can select a case during diagnosis; full verification leaves it unset.

## Execution

Run from the repository root. Set `BUN` to the verified Bun 1.3.14 executable and `CHROMIUM` to the existing bundled Chrome executable. The observed runtimes were Bun 1.3.14 revision `0d9b296af`, Node `v26.8.2`, and Chrome `153.0.8010.12` (Playwright cache `chromium-1243`). The scripts locate their repository from their own path and accept output filenames as arguments.

```sh
HARNESS=docs/final-readiness/execution/cloud/OWNER-UI-001/verification/expanded/harness
"$BUN" "$HARNESS/rox-readiness-ui-001.bundle-fixture.ts" navigation work/rox-readiness-ui-001.navigation-fixture.js
"$BUN" "$HARNESS/rox-readiness-ui-001.bundle-fixture.ts" main work/rox-readiness-ui-001.main-fixture.js
"$BUN" "$HARNESS/rox-readiness-ui-001.build-node-tests.ts" apps/electron/src/renderer/contexts/__tests__/rox-readiness-ui-001.navigation-browser.test.ts work/rox-readiness-ui-001.navigation-node-tests.mjs
"$BUN" "$HARNESS/rox-readiness-ui-001.build-node-tests.ts" apps/electron/src/renderer/components/app-shell/__tests__/rox-readiness-ui-001.browser.test.ts work/rox-readiness-ui-001.main-node-tests.mjs
```

Launch one isolated headless Chromium per lane. Use a fresh task-local profile, `--remote-debugging-port=0`, and read its `DevToolsActivePort` file. The external launch uses Playwright's normal background-throttling safeguards. Retain the process ID so cleanup stops only that owned browser.

```sh
UI001_BROWSER_PROFILE=$(mktemp -d "$PWD/work/rox-readiness-ui-001-chrome.XXXXXX")
"$CHROMIUM" --headless=new --disable-gpu --disable-background-networking --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-default-apps --disable-component-update --no-first-run --remote-debugging-port=0 --user-data-dir="$UI001_BROWSER_PROFILE" about:blank > work/rox-readiness-ui-001.chromium.log 2>&1 &
UI001_BROWSER_PID=$!
# Once DevToolsActivePort exists, read its first line into UI001_CDP_PORT.
UI001_CDP_PORT=$(head -n 1 "$UI001_BROWSER_PROFILE/DevToolsActivePort")
ROX_UI001_BROWSER_TEST=1 ROX_UI001_NAV_FIXTURE_BUNDLE="$PWD/work/rox-readiness-ui-001.navigation-fixture.js" ROX_UI001_CHROMIUM_CDP_URL="http://127.0.0.1:$UI001_CDP_PORT" node work/rox-readiness-ui-001.navigation-node-tests.mjs
kill -TERM "$UI001_BROWSER_PID"
```

For the MainContent lane, launch a separate fresh browser/profile, then run:

```sh
ROX_UI001_BROWSER_TEST=1 ROX_UI001_MAIN_FIXTURE_BUNDLE="$PWD/work/rox-readiness-ui-001.main-fixture.js" ROX_UI001_CHROMIUM_CDP_URL="http://127.0.0.1:$UI001_CDP_PORT" node work/rox-readiness-ui-001.main-node-tests.mjs
```

Each fixture builder writes a manifest containing the actual Git revision, qualified bundler runtime, SHA-256 of the bundle, and hashes of all real input files. MainContent's injected production functions and workspace restore effect are included explicitly. A test-only storage wait adjustment uses timer polling and restores the active viewport at each window switch; it neither writes the receiving store nor substitutes browser storage events.

## Preserved failure history

- Original Bun runs stopped before mounted cases: esbuild service stopped, including a repeated run and a minimal esbuild probe. The same esbuild build succeeded outside `bun:test`.
- The external Bun/CDP attempt timed out before mounted cases; Node connected to that same browser endpoint.
- The first Node navigation run observed 19 passes and two failures. One actual product gap was new-panel zero weight, which caused v2 URL restoration to reject the stack. The lead fixed insertion weight and added direct atom/URL regression coverage. One fixture failure was an automatic-semicolon-insertion mistake between two `resolveCreate` calls; it was corrected.
- MainContent first observed 10 passes and a 30-second cross-window timeout. A later attempt used an unhealthy old CDP host and failed before cases. A fresh host still exposed inactive-tab evaluation pauses. The trace shows the second page loaded with `ui001=true` and `[320,104]`, then the background writer evaluation stalled before any storage assertion. Explicit viewport activation fixed the exact storage case in 1.241 seconds with all three assertions; the full lane was rerun afterward.
- Failure logs and final manifests are adjacent to these scripts. Renderer fixture success remains bounded evidence; native receipts and external prerequisites have independent records.


## Final 5e549 callback binding and listener control

`rox-readiness-ui-001.mounted-result-5e549.json` records 35 passes, zero failures and 92 assertions: navigation24/0/69 and MainContent11/0/23. The final source is `5e5493b4e0772fb448712d9926163ec86943008d`. A fresh immutable rebuild reproduced every navigation input hash and bundle byte from the full24 run, which originally bundled with HEAD2247242 while the final guard/test edits were in the worktree. The receipt retains that original build context. MainContent was freshly bundled and rerun after freeze. Both owned headless Chrome process groups were stopped with verified profile/process-group ownership and observed exit; the native acceptance runner was untouched.

The old-code control replaces only `NavigationContext.tsx` with exact committed source from `5a0b769b894aed2ed09ba8bcbe01a41cf8149d76`. All three new callback tests and all other source inputs stay current. The old listener creates a session in the former workspace and overwrites the current route after workspace A→B→A; both tests fail. The current-listener positive control passes. This intentional control exits1, and its log/manifest are preserved. The final guarded effect passes all three controls.

To reproduce the control from the final repository:

```sh
git show 5a0b769b894aed2ed09ba8bcbe01a41cf8149d76:apps/electron/src/renderer/contexts/NavigationContext.tsx > work/rox-readiness-ui-001.NavigationContext-negative-5a0.tsx
"$BUN" "$HARNESS/rox-readiness-ui-001.bundle-negative-deep-owner.ts" navigation work/rox-readiness-ui-001.navigation-fixture-negative-deep-owner.js
# Launch a fresh isolated headless Chromium as described above, then:
ROX_UI001_TEST_FILTER='deep-link listener' ROX_UI001_BROWSER_TEST=1 ROX_UI001_NAV_FIXTURE_BUNDLE="$PWD/work/rox-readiness-ui-001.navigation-fixture-negative-deep-owner.js" ROX_UI001_CHROMIUM_CDP_URL="http://127.0.0.1:$UI001_CDP_PORT" node work/rox-readiness-ui-001.navigation-node-tests.mjs
```

The original mounted5a0 probe also shows the late former-B creation reply navigating currentA and sending the stale input. The scenario wrote its evidence successfully, then an external cleanup-script options typo caused process exit1. That full failed log remains alongside the evidence; the owned process was subsequently cleaned with ownership readback. This script failure does not replace the actual product observation or the deterministic old-code regression control.

# Pocket native restart — Chromium Local State repair

Owner: `/root/review_windows_vault`. Base: `b90db093e951fe98cdc259b9351a875eddebf5bd`. Root retains independent review and full acceptance. This follow-up was explicitly authorized by root after actual Windows failure.

Actual Windows run [37148566925](https://github.com/rox-one/rox-one/actions/runs/37148566925) at `26441ca2949c4fa8c01c44cee6b9734fe4c8dfd1` proves the durable-write repair worked: Electron 39.2.7, DPAPI available, writable fsync success, account/logout/binding write completed. Read failed at `account_read` after process restart. That receipt is preserved in `pocket-sso-windows-vault-repair-evidence/windows-native-26441ca-failed.json`. It does not prove why read failed.

## Pinned source diagnosis

[Electron v39.2.7 Browser::Exit](https://github.com/electron/electron/blob/v39.2.7/shell/browser/browser.cc#L92) directly calls native `exit(code)` if the main-loop exit code is not initialized. [ElectronBrowserMainParts](https://github.com/electron/electron/blob/v39.2.7/shell/browser/electron_browser_main_parts.cc#L436) emits ready on Windows in PreMainMessageLoopRun; WillRunMainMessageLoop later initializes that exit state. The existing probe performs synchronous storage wrapped in promises and then calls `app.exit(0)` from the ready continuation: this can take the early process-exit branch.

[BrowserProcessImpl](https://github.com/electron/electron/blob/v39.2.7/shell/browser/browser_process_impl.cc#L96) loads Windows OSCrypt preferences from sessionData/Local State and commits pending writes on native loop shutdown. [Electron's own safeStorage encryption fixture](https://github.com/electron/electron/blob/v39.2.7/spec/fixtures/api/safe-storage/encrypt-app/main.js) uses `app.quit()` after encrypting. These sources support an early-exit / missing-key-durability explanation. The exact failed Windows cause remains inferred until after repair readback.

Later normal product exits can use Electron's native shutdown path; no claim is made that all existing product `app.exit()` calls skip Local State. Product lifecycle/update/config code is unchanged in this first bounded repair.

## Change and acceptance contract

The probe explicitly sets both userData and sessionData to its owned temporary profile before ready, verifies the bound paths as one boolean, and uses `app.quit()` after successful phase completion. Errors remain fail closed with projected receipt and exit 1. No product profile or normal app is used.

The runner reads Local State after each actual Windows process has exited, extracts the wrapped encryption-key string only in memory, and computes an internal fingerprint. Published receipt contains **only** encryptedKeyPresent and encryptedKeyStable booleans, never key bytes, key fingerprints, paths or raw stderr. It requires a nonempty wrapped key after successful write and the same key after successful restart/read/clear. Failed read phases also get the presence/stability diagnostic. Missing, invalid or oversized Local State fails the key check. Mac still uses native Keychain proof.

Acceptance: actual Windows child write/read receipts both complete, profileIsolated true, DPAPI encryption available, writable fd flush succeeds, post-exit wrapped key present/stable, ciphertext unchanged, account/logout/binding recovered, clear readback null, runner temporary profile removed. Actual Mac equivalent must pass Keychain. These checks do not provide OAuth/provider or full GUI acceptance.

## Verified before Windows rerun

- Pinned Bun 1.3.14: **10 tests / 77 assertions / 0 failures**, including real temporary filesystem/store operations, Windows write-handle contract seam, redacted read-stage failures and Local State missing/invalid/replaced-key negative controls (`targeted.log`).
- Actual local Mac Keychain, Electron 39.2.7, two separate processes: write/read/clear passed with profileIsolated true (`native-mac-after.json`, `native-mac-after.log`). No BrowserWindow or normal ROX app was opened.
- Synthetic failure/accelerated hung runner controls pass; stderr/token canary omitted and temporary profiles removed (`runner-controls.log`).
- Focused strict diagnostics/test/runner typecheck passed (exit 0); diff whitespace check passed. The first standalone native-probe typecheck recursively pulled package source without repository compiler flags and failed on existing `.ts` import/JSX settings; saved as `proof-strict-types-initial.log`. Repository Electron project check is separate; native bundle was exercised by the actual Mac proof.
- Superseded b90 run [37149679540](https://github.com/rox-one/rox-one/actions/runs/37149679540) was observed fully queued with no job steps; metadata preserved, then only that own run was cancelled. No other run was cancelled.

Windows repaired native execution is **pending** at this report revision. Source commit and pushed SHA/run will be recorded after dispatch/readback. No production deployment, packaging publication or normal product configuration change is part of this follow-up.

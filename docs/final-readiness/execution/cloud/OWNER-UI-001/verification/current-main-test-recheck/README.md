# UI-001 verification on current main

The product repairs requested by UI-001.1 and UI-001.2 are already integrated through PRs [1400](https://github.com/rox-one/rox-one/pull/1400), [1420](https://github.com/rox-one/rox-one/pull/1420), [1457](https://github.com/rox-one/rox-one/pull/1457) and [1468](https://github.com/rox-one/rox-one/pull/1468). PR [1424](https://github.com/rox-one/rox-one/pull/1424) concerns credential metadata. This continuation preserves those product implementations and repairs the remaining test and evidence gaps.

The first fetch pinned `57871f492d1b21177ab767454d90395d72496b4e`. A second fetch found PR1470, and the isolated branch was fast-forwarded to `bb047b946da41346301cffe88a43db0adf621dcf` before final validation. All 24 UI-001 product source hashes are identical between these two main revisions. The original input was `76228cc33e44518e5fab5e59f5c754f4051d1e8c`; all eight Requirements/DoD/Full functional verification/Test method strings are still exactly equal to that revision and are copied into `original-contract.json`.

Changes:

- Storage-event fixtures update canonical storage before a normal event. Separate negative controls prove that obsolete queued writes, deletion and clear events cannot overwrite a newer preference. Existing bounds, corruption, denied-storage, RESET and unsubscribe controls remain.
- Session dispatch fixtures provide isolated real Jotai metadata and navigation readiness. Positive local/remote session mounts, loading despite a previous snapshot, and rejection of known foreign metadata exercise the current MainContentPanel.
- Component browser fixtures include the current tour collaborators and navigation hook used by the actual extracted MainContentPanel. Deleted-session expectations use the current missing surface; readiness checks preserve the requested address and prevent premature chat mounts.
- The real SourceInfoPage recovery fixture keeps the shipped SourceStatusIndicator/deriveConnectionStatus and the actual Tooltip module with its required provider. It resolves the Tooltip module directly to avoid unrelated UI-index font assets.
- The standalone navigation workflow uses current missing/unavailable selectors, retains its original history assertions and timeouts, and preserves the selected address and no-chat/no-message-loader checks. Failures include actual history write diagnostics. Recovery setup failures now print page errors and the visible error surface before cleanup.
- The committed24-source CI manifest now describes the tested current main inputs. The previous manifest is retained as `source-manifest-before.json`. The CI hash assertion is retained. The observed previous [main CI run](https://github.com/rox-one/rox-one/actions/runs/37152487633) failed on this hash gate before running tests.

`result.json` binds the commands, outcomes, runtime, tested file hashes and prerequisites. `logs/*.log.gz` and `logs/index.json` retain the initial failures and final passing runs, including the dependency-resolution, fixture compilation and provider failures. The inherited OWNER-UI-001 result and historical evidence remain untouched.

Local validation uses Bun 1.3.14, frozen lockfile dependencies and isolated headless Chromium 153.0.8010.12. Browser cases exercise actual renderer functions, navigation, route parsing, Jotai and callbacks with explicit IPC/presentation fixtures. The standalone recovery history adapter is a fixture; the standalone navigation script and mounted navigation tests exercise the real NavigationProvider.

This continuation does not establish the original installed Windows 10/11, native macOS compositor/modal/DPI, actual hosted web, service/backend receipt or integrated-candidate acceptance. `fullDoDClosed` remains `false`. It does not close the externally required platform work.

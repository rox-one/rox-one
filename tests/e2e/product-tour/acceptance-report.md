Independent acceptance is **partial; rollout gates remain open**. Product Learning must remain off by default until the outstanding application/platform evidence is collected. The 59 required cases and three mainline regression cases remain individually recorded in `acceptance-matrix.json`; component or synthetic evidence does not establish native application success.

The contract base is `f00ffcacc6a94a88b6e99b2f708224050842be7f`. The immutable production snapshot below is `a49ef4812e456939bbe1bfe715d5a3d0c71b2856`, tested in a clean `/workspace/rox-product-learning` on Linux Chromium 151, English, 1280×900, reduced motion. This snapshot includes mainline `2f03faa5` Surface Tabs changes. Later production changes require affected checks again.

| Check | Actual result | Evidence and limits |
| --- | --- | --- |
| Exact browser gate | PASS, exit 0; 13 passed, 0 failed, 0 skipped; 107.558304 seconds | `bun run test:product-tour:e2e`; `/workspace/product-tour-a9-final-a49ef481-e2e.log`; seven real App/native-store cases and six production component cases. |
| APP-01 / APP-06 flag absent | Application subset PASS | Existing authenticated isolated profile loads allSessions without a forced popup, automatic domain mutations, or a learning database open. Other page combinations remain untested. |
| APP-05 restricted WebUI | Application subset PASS | Sessions unavailable and direct host inventory read denied. Available Learning/Notes paths exercised; other host FS/OAuth and route combinations remain open. |
| DOMAIN-12 canonical Notes | Application PASS | Actual UI creation/edit → production bridge/queue/RPC → native journal and disk read-back → reload → search. No successful accessory inventory was substituted for the genuine asset-denial path. |
| T-LEARNING-LIBRARY / T-LEARNING-CONTROLS | Application PASS | Explicit Start and Next complete both acknowledgement steps without domain mutations. |
| T-NOTES-CREATE / T-NOTES-SAVE | Application PASS | Explicit Focus-control and keyboard creation dialog submission, then user-written editor content. Canonical file content and both durable verified learning milestones are checked. |
| Notes target geometry | Application PASS after reproduced defect | Persistent 112.4375 CSS px offset failed at `bf82a328`; `a0ff359a` production observer fix now passes the stable ≤2 CSS px metric. Fresh final App geometry also passes. Focus remains on the real target. Focused fix log: `/workspace/product-tour-a9-geometry-a0ff359a.log`. |
| Workspace route / ordinary navigation | Application subset PASS | Restricted WebUI honestly blocks an unavailable workspace switcher. Visible Runtime-settings navigation away from active Learning pauses the popup. Pending workspace/panel navigation remains open. |
| Six production UI component cases | Component PASS | Scope/stale cleanup, visible variants, hidden/clipped/frame rejection, geometry/focus/reduced motion, ordinary click, higher-layer Escape, and observer cleanup. Full App/native variants remain separate gates. |
| Root integrated feature gate | PASS, exit 0; 302 feature tests + 5 layer tests; 14,727 assertions | `bun run test:product-tour` at `7e0f6061`; `/workspace/product-tour-gates/feature.log`. Subsequent mainline Surface Tabs changes were covered by root affected checks and final A9 App E2E. |
| All 56 independent policies / first-response correlation | Historical integration PASS, exit 0; 125 tests, 1181 assertions | `/workspace/product-tour-a9-core-final.log`; production reducer/catalogue and normal/fast event-processor→adapter correlation. External model evidence is synthetic; real authorized App send is NOT_RUN. |
| macOS / Windows / microphone denial | NOT_RUN; Linux runner exit 2 | `/workspace/product-tour-a9-native-a49ef481.log`; native readiness records null native test exit codes. The real Electron fresh-setup smoke and CI are implemented; OS and manual cases were not run here. |
| Baseline renderer build | PASS, exit 0; 56.71 seconds | `c9b7330357fb55a5e88a223783029d2768849828`; `/workspace/rox-workers/A9-baseline-renderer-build.log`. |
| Candidate renderer / fixture isolation | PASS, exit 0; 101 seconds | Clean `a49ef481`; `/workspace/product-tour-a9-final-a49ef481-renderer.log`; all six fixture markers absent. |

The earlier `7e0f6061` run had 12 passes and one failure: cold App mounting exceeded the unchanged 60-second budget while multiple builds ran. Its trace shows slow successful dependency transforms and no App import exception. The trace is retained at `/workspace/product-tour-a9-first-7e0f6061-flag-off-timeout.zip`, with log `/workspace/product-tour-a9-final-7e0f6061-e2e.log`. An unchanged same-SHA full rerun passed all 13 in 102.280619 seconds after builders finished; the final synchronized snapshot above also passes. No timeout or assertion was weakened.

Build comparison uses the same Bun gzip level-9 implementation for both artifacts, excludes source maps, and includes intervening mainline changes. It does not attribute the entire delta to Product Learning.

| Artifact | Baseline | Candidate | Delta |
| --- | ---: | ---: | ---: |
| JS files | 386 | 389 | +3 |
| JS raw bytes | 26,537,285 | 27,132,931 | +595,646 |
| JS gzip bytes | 6,555,262 | 6,708,325 | +153,063 (+2.33%) |
| CSS raw bytes | 395,895 | 392,764 | −3,131 |
| CSS gzip bytes | 60,636 | 60,414 | −222 |

Candidate artifact SHA-256 is `c7a6aaf2c3152124a712e3f97c565f11eca1a6da2b6cfa70655f3b927c2fc5a4`; baseline is `aca02b2ad7f8ac9ef8e54fa2c7734087d74e58d7f1a535ade54c6cfa153a956f`. Bundle command `bun scripts/product-tour/bundle-report.ts /workspace/rox-workers/A9-baseline/apps/electron/dist/renderer` exited 0; `/workspace/product-tour-a9-final-a49ef481-bundle.log` records hashes, byte counts and clean tracked-worktree status. Duplicate route and large-chunk warnings existed in the baseline.

The browser harness mounts the production App, route providers, domain pages, WebSocket transport, native authority/journal, Notes handlers, main replica queue, and preload bridge. Test adapters supply owned profile enrollment, shell reads, credential-store DI and in-process IPC custody. Each page receives its own owned sender context, and window disposal is explicit. This establishes canonical persistence for the exercised Notes operation. It does not establish OS IPC identity or credential custody, packaged behavior, system-dialog focus, live OAuth/model delivery, unavailable host inventory, or every domain path.

Open rollout gates include the real authorized App first-response/draft/permission paths; other domain operations and restricted routes; the full App multi-panel/workspace/pending-navigation/native-layer/lease matrix; all macOS/Windows/manual microphone cases; and affected checks after subsequent production changes. Normal/fast first-response integration checks cannot close the real App send gate. `step-matrix.json` preserves every positive and premature/foreign policy expectation; A0-approved `sources.result` same-attempt/version 2 and `notes.create` real-dialog handoff/version 2 revisions are explicit.

The root integrator owns full repository typecheck/lint/localization/RX gate receipts and delivery. This report records independent A9 evidence and does not claim that all 59 acceptance cases passed.

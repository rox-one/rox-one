# Historical Product Learning source evidence

This report is copied source-branch evidence. Its Linux paths, revisions and PASS rows do not qualify this recovered candidate. Current source, tested revision, failures, limits and receipts are recorded separately in docs/spec.md, docs/plan.md and the recovery PR. Installed macOS/Windows and full domain acceptance remain independent until actually exercised.

Independent acceptance is **partial; rollout gates remain open**. Product Learning must remain off by default until the outstanding application/platform evidence is collected. The 59 required cases and three mainline regression cases remain individually recorded in `acceptance-matrix.json`; component or synthetic evidence does not establish native application success.

The contract base is `f00ffcacc6a94a88b6e99b2f708224050842be7f`. The immutable application/feature snapshot below is `f4c090ca9f09a05a38d653326f247eedc62cef46`, tested in a clean `/workspace/rox-product-learning` on Linux Chromium 151, English, 1280×900, reduced motion. It includes mainline `d4846751` native Voice delivery and responsive Notes changes, plus the final review fixes. The renderer was built at clean `616f3af10b7db097d9816b0fe96e9bda20ed807a`; the subsequent commits through the application snapshot change test harnesses only. Later production changes require affected checks again.

| Check | Actual result | Evidence and limits |
| --- | --- | --- |
| Exact browser gate | PASS, exit 0; 13 passed, 0 failed, 0 skipped; 95.61613 seconds | `bun run test:product-tour:e2e`; `/workspace/product-tour-a9-final-f4c090ca-e2e.log`; seven real App/native-store cases and six production component cases. |
| APP-01 / APP-06 flag absent | Application subset PASS | Existing authenticated isolated profile loads allSessions without a forced popup, automatic domain mutations, or a learning database open. Other page combinations remain untested. |
| APP-05 restricted WebUI | Application subset PASS | Sessions unavailable and direct host inventory read denied. Available Learning/Notes paths exercised; other host FS/OAuth and route combinations remain open. |
| DOMAIN-12 canonical Notes | Application PASS | Actual UI creation/edit → production bridge/queue/RPC → native journal and disk read-back → reload → search. No successful accessory inventory was substituted for the genuine asset-denial path. |
| T-LEARNING-LIBRARY / T-LEARNING-CONTROLS | Application PASS | Explicit Start and Next complete both acknowledgement steps without domain mutations. |
| T-NOTES-CREATE / T-NOTES-SAVE | Application PASS | Explicit Focus-control and keyboard creation dialog submission, then user-written editor content. Canonical file content and both durable verified learning milestones are checked. |
| Notes target geometry | Application PASS after reproduced defect | Persistent 112.4375 CSS px offset failed at `bf82a328`; `a0ff359a` production observer fix now passes the stable ≤2 CSS px metric. Fresh final App geometry also passes. Focus remains on the real target. Focused fix log: `/workspace/product-tour-a9-geometry-a0ff359a.log`. |
| Workspace route / ordinary navigation | Application subset PASS | Restricted WebUI honestly blocks an unavailable workspace switcher. Visible Runtime-settings navigation away from active Learning pauses the popup. Pending workspace/panel navigation remains open. |
| Six production UI component cases | Component PASS | Scope/stale cleanup, visible variants, hidden/clipped/frame rejection, geometry/focus/reduced motion, ordinary click, higher-layer Escape, and observer cleanup. Full App/native variants remain separate gates. |
| Root integrated feature gate | PASS, exit 0; 345 tests; 14,888 assertions | `bun run test:product-tour` at `f4c090ca`; `/workspace/product-tour-gates/feature.log`. This is 328 feature tests, 8 production input/browser cases, 5 layer tests and 4 real child-process supervision tests. Browser controls do not establish OS system-dialog acceptance. |
| All 56 independent policies / first-response correlation | Historical integration PASS, exit 0; 125 tests, 1181 assertions | `/workspace/product-tour-a9-core-final.log`; production reducer/catalogue and normal/fast event-processor→adapter correlation. External model evidence is synthetic; real authorized App send is NOT_RUN. |
| macOS / Windows / microphone acceptance | NOT_RUN; Linux runner exit 2 | `bun run test:product-tour:native` at `f4c090ca`; `/workspace/product-tour-gates/native.log`. Full manual platform cases remain open. The first CI attempt produced no accepted native test result; the repaired Node runner and visible Welcome assertions await a fresh OS run. |
| Baseline renderer build | PASS, exit 0; 56.71 seconds | `c9b7330357fb55a5e88a223783029d2768849828`; `/workspace/rox-workers/A9-baseline-renderer-build.log`. |
| Candidate renderer / fixture isolation | PASS, exit 0; 70.349773 seconds | Clean `616f3af1`; `/workspace/product-tour-a9-final-616f3af1-renderer.log`; all six fixture markers absent. Production code is unchanged through `f4c090ca`. |

The earlier `7e0f6061` run had 12 passes and one failure: cold App mounting exceeded the unchanged 60-second budget while multiple builds ran. Its trace shows slow successful dependency transforms and no App import exception. The trace is retained at `/workspace/product-tour-a9-first-7e0f6061-flag-off-timeout.zip`, with log `/workspace/product-tour-a9-final-7e0f6061-e2e.log`. An unchanged same-SHA full rerun passed all 13 in 102.280619 seconds after builders finished; the final synchronized snapshot above also passes. No timeout or assertion was weakened.

Build comparison uses the same Bun gzip level-9 implementation for both artifacts, excludes source maps, and includes intervening mainline changes. It does not attribute the entire delta to Product Learning.

| Artifact | Baseline | Candidate | Delta |
| --- | ---: | ---: | ---: |
| JS files | 386 | 389 | +3 |
| JS raw bytes | 26,537,285 | 27,175,555 | +638,270 |
| JS gzip bytes | 6,555,262 | 6,720,806 | +165,544 (+2.53%) |
| CSS raw bytes | 395,895 | 393,382 | −2,513 |
| CSS gzip bytes | 60,636 | 60,496 | −140 |

Candidate artifact SHA-256 is `bedd614f055b051368d3e24d80183b4dfdc8d331ee7a8854821cf95667239444`; baseline is `aca02b2ad7f8ac9ef8e54fa2c7734087d74e58d7f1a535ade54c6cfa153a956f`. Bundle command `bun scripts/product-tour/bundle-report.ts /workspace/rox-workers/A9-baseline/apps/electron/dist/renderer` exited 0; `/workspace/product-tour-a9-final-616f3af1-bundle.log` records hashes, byte counts and clean tracked-worktree status. Duplicate route and large-chunk warnings existed in the baseline.

The first product CI run was `37134335545` on PR head `dd9faa70`. Its browser/domain job failed one A11 pending-transcript browser test (303 passed, 1 failed); the synchronization repair is now integrated and the fresh local gate above passes. Windows built genuine Electron/main/preload/renderer successfully, then its previous Bun CLI smoke stalled without Playwright startup output for 14 minutes 25 seconds before cancellation. Its downloaded readiness artifact records `RUNNING` and a null smoke exit code, not PASS. macOS was cancelled while still queued. Logs and artifacts are retained under `/workspace/product-tour-ci/`; the revised runner uses the official Node Playwright CLI, a 180-second parent deadline, owned-process cleanup and explicit diagnostics. Linux child-process tests verify exit, failure, startup error and deadline cleanup; they do not establish Windows or macOS acceptance. Recent repository macOS jobs do obtain runners and succeed after long queues, so no total platform outage or exact organization quota cause is claimed.

The browser harness mounts the production App, route providers, domain pages, WebSocket transport, native authority/journal, Notes handlers, main replica queue, and preload bridge. Test adapters supply owned profile enrollment, shell reads, credential-store DI and in-process IPC custody. Each page receives its own owned sender context, and window disposal is explicit. This establishes canonical persistence for the exercised Notes operation. It does not establish OS IPC identity or credential custody, packaged behavior, system-dialog focus, live OAuth/model delivery, unavailable host inventory, or every domain path.

Open rollout gates include the real authorized App first-response/draft/permission paths; other domain operations and restricted routes; the full App multi-panel/workspace/pending-navigation/native-layer/lease matrix; all macOS/Windows/manual microphone cases; and affected checks after subsequent production changes. Normal/fast first-response integration checks cannot close the real App send gate. `step-matrix.json` preserves every positive and premature/foreign policy expectation; A0-approved `sources.result` same-attempt/version 2 and `notes.create` real-dialog handoff/version 2 revisions are explicit.

The root integrator owns full repository typecheck/lint/localization/RX gate receipts and delivery. This report records independent A9 evidence and does not claim that all 59 acceptance cases passed.

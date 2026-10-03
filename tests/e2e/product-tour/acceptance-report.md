Independent acceptance is **partial; release gates remain open**. The feature must remain off by default until the required application/platform evidence is collected. Automated component or synthetic domain evidence does not establish native application success.

The contract base is `f00ffcacc6a94a88b6e99b2f708224050842be7f`. Integrated checks below ran in `/workspace/rox-product-learning` as owners committed code and root runtime integration changed. Tested snapshots include `3652ad73`, `c49e76f3`, and `302cc0d4` plus root working-tree changes. Final immutable candidate checks must follow subsequent runtime corrections.

| Check | Actual result | Scope and evidence |
| --- | --- | --- |
| Independent 25-tour / 56-policy matrix and normal/fast first response | PASS, exit 0: 125 tests, 1181 assertions | `/workspace/product-tour-a9-core-final.log`; production reducer/catalogue; synthetic evidence. |
| Full integrated feature suite | PASS, exit 0: 257 tests, 14541 assertions, 14 files | `/workspace/product-tour-a9-feature-final.log`; includes production reducer, real Chromium IndexedDB, diagnostics, native Notes/task adapter stores and locale checks. |
| Six production UI component browser checks | PASS | `/workspace/product-tour-a9-browser-final.log`; panel scoping, stale cleanup, visible variants, hidden/clipped/frame rejection, <=2 CSS px geometry, retained draft/focus, reduced motion, ordinary click, higher-layer Escape and observer cleanup. Application/native variants remain separate gates. |
| APP-01 / APP-06 flag absent | Application PASS | Real App in authenticated isolated profile: no forced overlay/automatic mutation and no learning database open. |
| APP-05 restricted WebUI | Application subset PASS | Sessions unavailable; direct host getSessions rejects. Remaining routes remain open. |
| DOMAIN-12 canonical Notes | Application PASS | Actual Notes UI creation/edit -> production native bridge/queue/RPC -> journal/file read-back -> reload -> search. Baseline asset-denial and obsolete native sync opener defects were reproduced and fixed in product code; no successful asset fixture was substituted. |
| T-LEARNING-LIBRARY / T-LEARNING-CONTROLS | Application PASS, focused command includes another failing test | Production popup completes both ack steps after explicit Start/Next without domain mutations. `/workspace/product-tour-a9-guided-final.log`. |
| T-NOTES-CREATE / T-NOTES-SAVE guided outcome | OPEN: application test failed before first popup | Actual Notes route appears, then status says panel/workspace changed. Root is correcting runtime navigation binding. The direct canonical Notes domain path above passes independently. |
| macOS / Windows / microphone denial | NOT_RUN, native runner exit 2 on Linux | `test-results/product-tour/native-readiness.json` retains all manual platform gates. Real Electron-only fresh-setup smoke and CI are implemented; neither was executed on these OSes here. |
| Baseline renderer build | PASS, exit 0 at c9b73303 | `/workspace/rox-workers/A9-baseline-renderer-build.log`; 386 JS files, 26,537,285 raw bytes. |
| Integrated renderer build and production fixture isolation | PASS, exit 0, 72 seconds | `/workspace/product-tour-a9-candidate-renderer.log`; 389 JS files, 27,051,055 raw bytes; six fixture markers absent. This is a working-tree artifact, not a final immutable candidate claim. |

The build comparison uses the same Bun `gzipSync` level-9 implementation for both artifacts: baseline JS 6,555,262 gzip bytes; candidate JS 6,686,117; delta +130,855 (+2.00%). Raw JS delta is +513,770. CSS changes from 395,895 raw / 60,636 gzip to 392,853 raw / 60,401 gzip, delta -3,042 / -235. Earlier standalone baseline numbers used Python gzip and differ by compressor implementation; they are not mixed into this comparison. Source maps are excluded. `bundle-report.json` identifies artifact hashes and tracked-worktree dirtiness.

Actual commands (Bun on PATH):

```sh
bun test apps/electron/src/renderer/features/product-tour/__tests__/integration
# exit 0: 125 pass
bun test apps/electron/src/renderer/features/product-tour
# exit 0: 257 pass
CHROMIUM_EXECUTABLE=/usr/bin/chromium bun x playwright test --config tests/e2e/product-tour/playwright.config.ts
# exit 1: 9 pass, Learning selector ambiguity; fixed afterward
CHROMIUM_EXECUTABLE=/usr/bin/chromium bun x playwright test --config tests/e2e/product-tour/playwright.config.ts --project real-app-isolated-native-store --grep 'T-LEARNING|T-NOTES'
# exit 1: Learning passed; guided Notes runtime scope change failed
bun scripts/electron-build-renderer.ts
# exit 0
bun scripts/product-tour/bundle-report.ts /workspace/rox-workers/A9-baseline/apps/electron/dist/renderer
# exit 0: fixture isolation and actual delta
bun scripts/product-tour/run-native.ts
# exit 2: Linux NOT_RUN, not a green skip
```

`acceptance-matrix.json` retains all 59 required cases, including partial and NOT_RUN states. `step-matrix.json` retains all 56 independent policy expectations. A0 approved `sources.result` same-attempt/version 2 and `notes.create` real-dialog handoff/version 2 revisions after actual integration inspection.

The application harness mounts the production App, route providers, domain pages, WebSocket transport, native authority/journal, Notes handlers, main replica queue and preload bridge. Adapters provide owned profile bootstrap/enrollment, shell reads, credential-store DI and in-process IPC delivery. It does not establish OS IPC sender identity or credential custody, packaged behavior, system-dialog focus, live OAuth/model delivery, unavailable host inventory, or every domain path.

Open release gates include the real authorized App first-response/draft/permission paths; other domain operations and restricted routes; application multi-panel/workspace/native-layer/lease behavior; all macOS/Windows/manual microphone cases; and fresh final-SHA build/typecheck/lint/validation after runtime corrections. First-response normal/fast integration tests cannot close the corresponding App send gate. `CORE`, storage and component passes do not silently replace application/platform requirements.

Independent acceptance is **not release-complete**. This report distinguishes implemented checks from executed evidence; missing application or platform evidence blocks the corresponding acceptance case.

Contract base: `f00ffcacc6a94a88b6e99b2f708224050842be7f`. Application baseline runs below used that checkout plus A9 test code, before tour integration. The production catalogue/reducer/component checks must run again against the integrated candidate SHA.

| Check | Actual result | Evidence |
| --- | --- | --- |
| Baseline production renderer build at `c9b7330357fb55a5e88a223783029d2768849828` | PASS, exit 0 | `/workspace/rox-workers/A9-baseline-renderer-build.log`; 386 JS files, 26,537,285 raw / 6,540,568 gzip bytes; CSS 395,895 raw / 60,588 gzip bytes. |
| APP-01 / APP-06 flag absent | Baseline application PASS | Real App rendered; no forced tour, no overlay or automatic domain mutations. |
| APP-05 restricted WebUI | Baseline application PASS | Real App rendered Sessions unavailable; direct host `getSessions` rejected. |
| DOMAIN-12 native Notes UI | BLOCKED, application command exit 1 | `refreshAssets` calls native-denied `notes.LIST_ASSETS`, disabling the Notes surface. A temporary accessory adapter exposed an additional autosave startup race; that adapter was removed and no success counted. |
| macOS, Windows, microphone denial | NOT_RUN, native command exit 2 on Linux | Native runner writes `test-results/product-tour/native-readiness.json`; no fixture fallback. |
| Playwright discovery | PASS, exit 0 | Nine initial tests discovered across application/component projects. Discovery is not execution. |
| 56 policy positive / premature / foreign event matrix | Implemented, NOT_RUN before core/catalogue integration | Production reducer and catalogue imports; fixture is expected policy data only. |
| Production UI spotlight / cleanup | Implemented, NOT_RUN before UI integration | Production registry and overlay, separate component evidence project. |
| Candidate bundle comparison | NOT_RUN | `bundle-report.ts` requires separately built production baseline and candidate artifacts and rejects fixture markers. |

Actual commands executed from A9 (Bun on PATH):

```sh
CHROMIUM_EXECUTABLE=/usr/bin/chromium bun x playwright test --config tests/e2e/product-tour/playwright.config.ts --grep 'APP-01|APP-05|DOMAIN-12'
# exit 1: 2 passed, DOMAIN-12 blocked/failed. No green skip.
bun x playwright test --config tests/e2e/product-tour/playwright.config.ts --list
# exit 0: discovery only.
bun scripts/product-tour/run-native.ts
# exit 2: Linux NOT_RUN, all three platform/manual cases explicitly retained.
git diff --check
# exit 0.
```

`acceptance-matrix.json` retains all 59 acceptance cases, owner, level, release-blocking status, and current evidence state. `step-matrix.json` maps every one of the 56 atomic IDs to an executable policy check. Pure synthetic signals do not establish native domain outcomes. The first-response integration check composes the production event processor, chat adapter and reducer with synthetic external model replies; it does not establish real App send wiring.

Application harness adapters are limited to owned profile bootstrap/enrollment, shell reads, credential-store DI, and in-process IPC delivery. The native authority, native journal, Notes handlers, main replica queue, preload bridge, App, and route providers are production implementations. The harness does not claim packaged/native success, OS credential custody, system-dialog behavior, host asset inventory, live OAuth/model delivery, or all domain outcome paths.

Open release gates include native macOS/Windows/manual evidence, first response/draft/permissions application paths, multi-window lease and multi-panel runtime application checks, remaining domain outcomes, full restricted WebUI route coverage, candidate build comparison, and root typecheck/rx validation. Owner pure tests are supplementary evidence and cannot silently replace these application/platform requirements.

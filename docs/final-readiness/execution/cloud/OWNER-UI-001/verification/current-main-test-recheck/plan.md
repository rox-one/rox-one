# Execution graph

| Task | Owner | Depends on | Output | Proof |
| --- | --- | --- | --- | --- |
| main-readback | root | none | pinned main, merged PRs and unchanged task contract | Git/GitHub readback |
| geometry-fixture | audit_current_geometry | pinned main | geometry.test.ts | original red and canonical/stale-event green |
| dispatch-fixture | audit_current_routes | pinned main, frozen install | component harness and dispatch test | original selector red, local/remote/readiness controls |
| browser-fixture | root | current main | browser.test.ts | actual callbacks, click/retry/reload/cross-window |
| mounted-script-compatibility | audit_current_routes | fixture repairs | real source collaborator and navigation script | unchanged original mounted cases |
| source-binding | root | source readback | current 24 hashes and prior manifest | original main CI failed gate, fresh gate passes |
| integration | root | all repairs | test/typecheck logs and result | fresh combined tests, mounted browser/scripts |
| delivery | root | integration | ordinary commit/push and PR | remote SHA and PR readback |

No force push or mutation of foreign worktrees. The initial stale checkout/cloud patch stays under work and is not carried into this branch. Prior failures and the old manifest are retained.

Checkpoint: all local verification tasks completed on bb047b946da41346301cffe88a43db0adf621dcf. Unit regression891/0, separate mounted navigation37/0, component browser12/0, navigation workflow17/0, recovery workflow22/0, Electron typecheck, renderer build and validate:ci passed. Original failures and final logs archived with raw/gzip hashes. Next action: ordinary commit/push and PR; obtain exact remote SHA and PR readback. Full original platform acceptance remains external and fullDoDClosed=false.

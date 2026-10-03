# UI-001 execution plan

Tier: bounded-workflow; one writer retains the package's original no-further-delegation boundary.

| ID | Owner | Dependencies | Action and artifact | Verification |
|---|---|---|---|---|
| verify-input | OWNER-UI-001 | none | Freeze input, original result, contract and cloud diff digest | Exact HEAD; preserved requirements; allowed path inventory |
| qualify-runtime | OWNER-UI-001 | verify-input | Task-local Bun 1.3.14 and frozen dependencies | Version and artifact hash; lockfile unchanged |
| geometry | OWNER-UI-001 | qualify-runtime | Real atom read/write/reload regressions and bounded storage fix | Reproduce live invalid state and storage-denial failures; rerun callbacks |
| routes | OWNER-UI-001 | qualify-runtime | Route host and rapid entity/workspace transition verification; owned fixes where reproduced | Direct canonical routes, missing routes, back/reload and late callbacks |
| regression | OWNER-UI-001 | geometry, routes | Original regression entry point and typecheck evidence | Preserve all failures; compare unrelated failures to input |
| deliver | OWNER-UI-001 | regression | Structured result, patch, source manifests and target workflow prerequisites | Scope check, patch apply/readback, no unauthorized delivery actions |

Next action: deliver the revision-bound patch and evidence; the lead integrates the non-owned proposals and then runs the original target acceptance lanes. All test receipts retain commands, runtime, exit code, source hashes and logs. Native/hosted workflows are separate target lanes; component fixtures do not close them.

Final product commit: `3b32a3e44b08d09966b336e0acf038f9dce7af5a`. Owned behavior 30/30 and headless mounted-component scenarios 7/7; Electron typecheck and renderer build pass. Original app-shell entry has 248 pass/1 pre-existing sash fixture failure. Extended layout entry has 16 pass/1 non-owned source-text assertion mismatch. Unapplied proposals, original failure history and native/hosted target workflows are prepared. No running worker or automation is claimed.

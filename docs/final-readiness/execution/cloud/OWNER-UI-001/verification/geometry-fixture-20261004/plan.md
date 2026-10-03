# Plan

1. Lead: fetch and freeze main, check merged PR ancestry, retain old checkout. Complete.
2. Route scout: compare old findings against current product/parser/history tests. No demonstrated remaining production defect. Complete.
3. Geometry worker: reproduce four stale-fixture failures, update committed-event helper and retain independent queued-event controls. Complete.
4. Lead: run qualified Bun 1.3.14 geometry tests, unchanged UI recovery CI regression entry point, and mutation control for the corrected queued-event contract. Complete: 22/0 geometry, 876/0 regression (141 browser/opt-in skips), Electron typecheck exit 0; mutation rejects incorrect event payload replay.
5. Lead: review scope, preserve red/green logs and exact source hashes, commit/push this branch without force, create PR, verify remote diff and head. In progress; independent review found no issues.

Ownership: root handles integration and delivery; geometry worker is sole writer of the test. Scouts are read-only. No changes to rox-release-20261003 or other branches.

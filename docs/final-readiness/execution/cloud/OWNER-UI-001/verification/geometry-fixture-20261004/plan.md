# Plan

1. Lead: fetch and freeze main, check merged PR ancestry, retain old checkout. Complete.
2. Route scout: compare old findings against current product/parser/history tests. No demonstrated remaining production defect. Complete.
3. Geometry worker: reproduce four stale-fixture failures, update committed-event helper and retain independent queued-event controls. In progress.
4. Lead: run qualified Bun 1.3.14 geometry tests, unchanged UI recovery CI regression entry point, and mutation control for the corrected queued-event contract. Depends on 3.
5. Lead: review scope, preserve red/green logs and exact source hashes, commit/push this branch without force, create PR, verify remote diff and head. Depends on 4.

Ownership: root handles integration and delivery; geometry worker is sole writer of the test. Scouts are read-only. No changes to rox-release-20261003 or other branches.

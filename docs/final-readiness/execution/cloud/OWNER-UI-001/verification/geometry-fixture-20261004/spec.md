# UI-001 geometry fixture consistency

Input: fresh origin/main `47b5fcd270ff7abff163533b60f4d9fa5d5f8f27`, after fetch on 2026-10-04. Merged PRs #1400, #1420, #1424, #1471 and #1478 are ancestors. The earlier source defects are already repaired.

The remaining defect is in `rox-readiness-ui-001.geometry.test.ts`: its synthetic storage events do not mutate backing storage, and two test cases per atom expect queued `event.newValue` to replace the current persisted value. Production intentionally rereads current canonical storage to discard obsolete queued events.

Acceptance: real committed writes, corrupt values, deletion and clear update the atom; an older queued write/deletion/clear never overrides the current stored preference. Filtering other keys/areas and listener cleanup remain tested. Existing geometry bounds, RESET, denied storage and reload controls remain intact.

Scope: the isolated geometry test and these owner evidence files only. No production changes, lockfile changes, deployment, signing, provider calls, or changes to any other working tree. Original UI-001.1/.2 contract remains unchanged; full platform DoD remains open.

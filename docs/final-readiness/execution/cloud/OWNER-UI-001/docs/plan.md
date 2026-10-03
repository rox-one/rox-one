# Dependency graph and owners

1. Shared parser and unavailable state (patch_scout): malformed encoding safety, strict view boundary, preserved raw-route roundtrip, canonical route tests. Root consumes the approved interface.
2. Renderer routing (root): real NavigationProvider raw restore/history/readiness/deep-link handling, explicit missing/cross-workspace session surfaces, panel isolation and canonical page/cloud data recovery. Depends on1.
3. Leaf lifecycles and layout (geometry): PageView workspace identity/fallback/lease recovery, ProjectInfoPage async fencing, actual sash regression checks. Current main already fixed the prior inset mismatch; retain supported geometry.
4. Product E2E (spec_review): rebuilt current Electron in isolated profile, real backend seeds/API/history/reload/delete and screenshots. Depends on1-3 and root's test-only OS protocol-registration isolation. No fabricated/native/hosted acceptance labels.
5. Integration (root): bounded tests, typecheck/full validate:ci/build, independent review, preserved failure history and revision manifests, commit/push/PR, actual checks, expected-head main merge and remote hash readback. Depends on1-4.

Prior PR1400 and its evidence remain history. This stage records separate results against635fc495d02c3fe1380740444cb90cf4fbdb58d9.

## Verified delivery checkpoint

Frozen product `5e5493b4e0772fb448712d9926163ec86943008d` includes integrated main `ae19683e69f079893cd09065487cfa7653d01154`. All five work streams completed product implementation and local proof. Root owns only evidence/test assertion updates after freeze; all2776 shipped source hashes remain identical. Qualified full CI passed, broad709/0 with78 opt-in skips, mounted35/0, and strict unpackaged native replay passed19 stages/32 screenshots. Independent review found and verified the retained deep-link and service-selection repairs. Historical failures and original contract remain preserved.

Next delivery action: commit/push final evidence, mark PR1420 ready, merge the expected head under the user's explicit authorization, then record GitHub merge/main readback and authored source hashes in the project outputs. Original cross-platform/installed/hosted/provider acceptance stays open (`fullDoDClosed:false`).

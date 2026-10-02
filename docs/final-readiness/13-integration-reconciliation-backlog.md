# [INTEGRATION-RECONCILIATION] Integration, tests and rechecking after branch reconciliation

The original INT/QA/REL/RECHECK acceptance remains applicable. These additional tasks address accumulated work outside `main`, conflicting source lineages and uncommitted runtime changes. Targets: A Windows 10/11, B macOS, C hosted authenticated web. A successful audit or branch check does not complete a product release.

## [INT-016] Establish one feature-preserving release candidate from the accumulated ROX work

**Code references:** [assembled candidate manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/package.json#L1); [September manifest](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/package.json#L1); [Compound manifest](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/package.json#L1).

- **Requirements:** Define an integration order for PR1322, PR1293, Compound, source-authority/Focus/project-generation refinements, sidebar1321, core/SQLite fixes, roadmap recovery and UTB1314. Use the complete source catalog rather than choosing the newest timestamp. September and assembled cloud heads are different lineages: a whole-file replacement can remove Search, roadmap, shared projections or repository snapshots. Retain native authority/write ownership, workspace scoping, caller ACK ordering, encrypted durable state, privacy fences and release identity. Resolve conflicts against behavior contracts and pin every imported commit.
- **DoD:** One clean candidate branch contains the selected feature set, an explicit disposition for every competing source line and no silent loss of previously working behavior. A/B/C capability matrix, migrations, artifact names and server/client contracts agree. Every original and added task is tied to that candidate and an open/closed acceptance decision.
- **Full functional verification:** Use the same fixture workspace across old candidate and integrated candidate; exercise Search, roadmap/OKR, Notes, personal tasks, Focus, browser/server sessions and account sync; restart processes and compare authoritative readback. Repeat negative workspace/identity cases and selected regressions after each integration step.
- **Test method:** Run relevant behavior suites at each imported commit; run the full workspace compiler inventory and required root gate; execute actual A/B/C vertical journeys on the final combined commit. Record source parents, conflict choices, expected state and actual persisted results.

### [INT-016.1] Integrate September refinements without deleting assembled product surfaces

**Code references:** [cloud route host](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx#L1); [September route host](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx#L1).

- **Requirements:** Compare route registry, lazy imports, project projections, repository snapshots and task source authority across both lines. Apply later fixes to the assembled contract individually; enumerate intentionally retired routes and all supporting files. Reject an import that removes a retained feature or reinstates a local-only writer.
- **DoD:** Every retained screen is reachable with the intended authority/source model; September fixes are preserved; route/module differences have explicit decisions and regression coverage.
- **Full functional verification:** Navigate all retained screens, open stale deep links, switch workspaces during pending RPCs, refresh and reconnect; verify correct workspace content and persistence on A/B/C.
- **Test method:** Route registration/reachability tests plus project scope, caller-session loading, personal-task confirmation and Notes read/write lifecycle suites; browser and native full-route smoke with actual server readback.

### [INT-016.2] Preserve native write authority, durability and caller acknowledgement

**Code references:** [native authority](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/authority/native-authority.ts#L1); [native journal](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/authority/native-journal.ts#L1); [before-response tests](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/transport/__tests__/before-response-authority.test.ts#L1).

- **Requirements:** Keep a single canonical writer for Notes and native entities; preserve operation identity, durable journal/outbox and workspace-bound authorization. Successful RPC response must follow the authoritative commit required by its contract. Define deterministic recovery for crash before commit, after commit/before ACK and duplicate retries.
- **DoD:** No double writer, phantom success, lost acknowledged mutation or cross-workspace mutation is possible in the supported contract. Journal/outbox migrations and backups retain replayability and encrypted content.
- **Full functional verification:** Kill server/client at each write boundary; reconnect, replay and compare authoritative entity revisions and emitted events. Attempt forged workspace/identity calls and repeat on installed desktop and hosted topology.
- **Test method:** Run authority, journal, account-replica, before-response, acknowledged-workspace and native content integration behavior suites; add subprocess crash tests around the combined candidate and verify disk readback.

### [INT-016.3] Reconcile source truth, projects, Focus and recovery branches

**Code references:** [September shared modules](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/packages/shared/package.json#L1); [server project RPC](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server-core/src/handlers/rpc/projects.ts#L1).

- **Requirements:** Compare native and external task source ownership, source registration readiness, Linear parsing, project generation/request epochs and notification scope. Reconcile recovery snapshots against committed implementation. Explain every fallback and ensure the displayed source/connected state describes usable canonical data.
- **DoD:** Project/task/Focus screens share the selected source authority, stale requests cannot contaminate the current workspace and recovery preserves provenance and revisions. External source outages show honest state and support a retry path.
- **Full functional verification:** Trigger rapid workspace changes and delayed provider replies; disconnect external source, create/update/delegate tasks, recover interrupted generation and confirm ownership and notification routing after restart.
- **Test method:** Execute source-status runtime, project scope/generation and task confirmation suites plus actual provider-controlled fixtures with delayed/failed replies; native and hosted UI readback.

### [INT-016.4] Integrate Unified Tables by supported contract and host surface

**Code references:** [UTB branch manifest](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/package.json#L1); [Compound manifest](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/package.json#L1).

- **Requirements:** Inventory the 23 specified UTB host surfaces, distinguish the implemented UTB01 codec from specification-only work and preserve strict references/native migration fences. Choose supported grid/formula/edit semantics and map old Notes Base/Data/extra-screen behavior to the common authority model.
- **DoD:** Each selected host has an explicit integrated implementation and verified persistence/permissions; unsupported hosts are disclosed or excluded by product contract. Codec success does not close the other hosts.
- **Full functional verification:** Create typed rows and relations, edit/delete/reorder, import/export, evaluate formulas, reload across clients and test stale references and unauthorized access on A/B/C.
- **Test method:** Codec/reference negative suites, host-specific grid/editor behavior suites, migration round trips and actual cross-client authoritative readback for every selected host.

## [INT-017] Preserve and qualify the uncommitted implementation before release integration

**Code references:** [OMP committed source](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/src/agent/omp-agent.ts#L1); [Compound committed source](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/package.json#L1). Uncommitted paths/status are catalogued in [progress snapshot](evidence/progress-snapshot.json); they have no immutable GitHub code reference yet.

- **Requirements:** Separate committed sources from dirty Compound, September, baseline CSS and previous-audit OMP/voice/runtime edits. Preserve user state and ongoing edits; coordinate a reproducible commit boundary for changes selected for release. Review actual diffs before copying, and distinguish implementation from generated research/runtime artifacts. Do not overwrite active worktrees or represent local changes as delivered code.
- **DoD:** Every selected dirty change has a source owner, immutable reviewed commit, dependency/compatibility assessment, tests and integration disposition. Unselected changes remain preserved. Release checkout is clean and reproducible.
- **Full functional verification:** Recreate the selected changes in a clean checkout, run the affected native/browser/service workflow, restart and verify persistence. Compare with captured committed sources and check that ongoing worktree data remains intact.
- **Test method:** Exact diff review and tracked-file integrity checks; affected OMP protocol/voice/notes/projects suites; clean frozen-lock build and A/B/C smoke tied to the new commits.

### [INT-017.1] Qualify OMP and voice changes from the previous audit checkout

**Code references:** [OMP protocol notes](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/docs/omp-rpc-notes.md#L1); [shared manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/shared/package.json#L1).

- **Requirements:** Review pending wrappers, RPC hardening, model handling, edge TTS adapters, locale and toolchain changes against the OMP protocol. Verify extension_ui_response and set_model shapes, host-tool permissions, abort/restart, stdout framing and provider-specific audio semantics. Pin runtime binaries and dependency licenses before delivery.
- **DoD:** Selected changes are committed and replayable; no protocol desynchronization, leaked secrets, hanging approval or false audio/provider status remains. Provider/live and fixture evidence are distinguished.
- **Full functional verification:** Run actual OMP sessions with thinking, tools, approval denial/timeout, branching, reconnect and cancellation; record voice input/output with unavailable devices/provider failures and retry on all supported targets.
- **Test method:** Protocol transcript replay and process-boundary tests, isolated installed OMP smoke and audio device/provider journey; no paid/live-provider success inferred from adapter mocks.

### [INT-017.2] Establish an immutable boundary for Compound and September work in progress

**Code references:** [Compound manifest](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/package.json#L1); [September manifest](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/package.json#L1).

- **Requirements:** Record dirty paths and inspect selected diffs without altering active checkouts. Identify generated files versus product logic and preserve changes to screen dossier, decisions, legal evidence, notes and related supporting modules. Recheck live status immediately before selecting a commit because work is ongoing.
- **DoD:** Chosen changes are represented by immutable commits with feature and test ownership; snapshots identify their capture time. No release claim depends on uncaptured local state.
- **Full functional verification:** Recreate a clean source candidate, exercise affected screens and transitions, persist/restart and compare native/hosted authoritative results.
- **Test method:** Diff review, build/compiler and affected behavior suites, exact commit/source manifest comparison and native/browser acceptance with persisted readback.

## [QA-011] Qualify all workspaces and close remaining viewer, messaging and runtime failures

**Code references:** [root compiler chain](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/package.json#L32); [viewer compiler configuration](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/viewer/tsconfig.json#L1); [platform contract](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/core/src/rox2/platform-contract.ts#L698-L700).

- **Requirements:** Treat the original 11 failing workspaces as a historical baseline, not the current candidate. The independent candidate inventory has 16 passing and two failing workspaces: viewer and messaging-gateway. Run all 18 independently, including viewer, CLI, WebUI, messaging/cloud and new workspace-service, which are not all in the root typecheck chain. Resolve the observed viewer ES library mismatch for Object.hasOwn and the messaging contract/test mismatches. Run the second viewer functions compiler stage after the first succeeds. Qualify the built server on supported Bun versions; Bun1.4.2 builds but the observed bundle fails before readiness with exports_tmp undefined.
- **DoD:** All selected workspace compiler commands and the required root gate pass on the integrated candidate; target language/library support and runtime browser compatibility agree. Gate omissions, skips and chained-command short circuiting are visible in CI output.
- **Full functional verification:** Produce and open viewer and WebUI production builds in supported browsers; verify the platform-contract path, shared imports, functions/service deployment boundary and public share behavior. Run source/compiler checks on fresh A/B/C build hosts.
- **Test method:** Independent manifest-driven compiler inventory, viewer functions compiler stage, frozen-lock build and actual viewer route/share smoke. Retain exact per-package exit codes and diagnostics; do not equate type correctness with full release qualification.

### [QA-011.1] Make CI coverage match the declared workspace and target inventory

**Code references:** [CI Validate Alias](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/.github/workflows/ci.yml#L1); [SQLite recovery job](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/.github/workflows/sqlite-runtime-recovery.yml#L1).

- **Requirements:** Enumerate actual commands behind green checks; add absent workspace checks and target build/runtime qualification. Retain real HTTP/WebSocket server lifecycle and persistent restart controls. Distinguish Ubuntu/macOS SQLite subsets, broad validate:ci, native acceptance/performance jobs and unsupported/missing exports.
- **DoD:** CI evidence maps every release requirement to a substantive passing job or an explicit blocking manual gate. Cancelled, queued, failed and skipped jobs cannot be described as a complete green release.
- **Full functional verification:** Execute the combined pipeline on the pinned release candidate, inspect uploaded artifacts, trigger a real deliberate failure in a controlled test and confirm gate rejection.
- **Test method:** Manifest/job coverage mapping, workflow command readback, clean runner rerun and negative gate control; read back job conclusions and tested source SHA.

### [QA-011.2] Correct and verify viewer ES library and runtime compatibility

**Code references:** [viewer tsconfig](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/viewer/tsconfig.json#L1); [Object.hasOwn use](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/core/src/rox2/platform-contract.ts#L698-L700).

- **Requirements:** Choose a compatible ownership check or explicitly supported ES2022 library/runtime contract. Verify both viewer compiler configurations, bundled dependency behavior and the oldest supported browser; avoid adding a declaration that hides an unavailable runtime method.
- **DoD:** Both viewer compiler stages pass and the relevant contract behavior executes in each declared supported browser without missing-method failures.
- **Full functional verification:** Open a shared item with boundary object keys, malformed/unsupported data and expected owned properties; confirm correct acceptance/rejection and rendering on the browser matrix.
- **Test method:** Compiler rerun, behavior tests for ownership checks and browser execution against the actual production viewer artifact.

### [QA-011.3] Reconcile messaging-gateway types with the supported access and transport contracts

**Code references:** [messaging manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-gateway/package.json#L1); [access-control tests](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/messaging-gateway/src/__tests__/access-control.test.ts#L1).

- **Requirements:** Resolve the 123 diagnostic occurrences from the independent candidate gateway compiler run; group by root cause rather than treating occurrences as independent bugs. Align supported access modes/reject reasons, binding stores, route/RPC results and worker contracts; update stale tests to the intended behavior and fix production mismatches. Preserve fail-closed identity/channel authorization.
- **DoD:** Gateway typecheck and behavior suites pass with current supported contract types, and messaging workers/service/client agree. No cast or compiler exclusion hides an authorization or runtime mismatch.
- **Full functional verification:** Configure an isolated bot/worker fixture, bind authorized and unauthorized users/channels, change access mode, send and receive messages, reconnect/restart and inspect persisted routing/permission decisions.
- **Test method:** Independent gateway compiler rerun, access-control/binding/worker contract suites and supported messaging-provider integration smoke; record actual external-provider evidence separately from local fixtures.

### [QA-011.4] Pin and qualify the supported Bun/server bundling toolchain

**Code references:** [SQLite CI Bun pin](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/.github/workflows/sqlite-runtime-recovery.yml#L1); [built server smoke](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/server/src/__tests__/smoke.test.ts#L1).

- **Requirements:** Define supported Bun build/runtime versions and ensure local, CI, container and shipped/server startup agree. Reproduce the Bun1.4.2 bundled tmp-module ReferenceError and compare the CI-pinned1.3.14 toolchain. Either fix compatible bundling/dependency handling or constrain the supported toolchain explicitly; an exit-zero bundle build is insufficient.
- **DoD:** The actual produced server starts, serves authenticated HTTP/WebSocket, stops gracefully and restarts durable state on every supported toolchain/OS combination. Unsupported versions fail with a clear preflight rather than a startup crash.
- **Full functional verification:** Build using each supported compiler, run the produced artifact with the declared runtime, execute authenticated login/RPC plus negative token cases, stop/restart the same fresh fixture profile and verify persistence.
- **Test method:** Built-artifact standalone smoke with explicit ROX_SERVER_SMOKE_ENTRY/WEBUI_DIR, subprocess build and version-recorded compiler/runtime matrix; retain failure stack and passing pinned-toolchain evidence.

## [RECHECK-004] Close source reconciliation and release evidence on the final combined commit

**Code references:** [baseline manifest](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/package.json#L1); [assembled candidate manifest](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/package.json#L1).

- **Requirements:** Use the 779-ref/735-head catalog and 928-PR history to record source disposition. An ancestry delta can represent a squash-merged historical branch, rejected experiment, backup, specifications or current implementation. Require behavior/patch review before claiming a missing feature or dropping a branch. Pin final source and rerun all affected acceptance; retain unresolved tasks and limits explicitly.
- **DoD:** Every release-relevant source line has a documented retain/integrate/supersede/exclude decision with evidence; every task has final integrated status and full target verification. Canonical ROX docs and machine-readable export refer to the same release candidate and evidence packet.
- **Full functional verification:** Rebuild from a fresh checkout of the final commit, install signed A/B artifacts and exercise the hosted C deployment with real configured integrations; restore backup, update/restart and recheck critical negative cases.
- **Test method:** Automated source catalog and pinned-link validation, patch/behavior comparisons for ambiguous branches, clean build/install/deploy readback and independent final journey evidence.

### [RECHECK-004.1] Resolve historical, squash-merged and closed source branches explicitly

**Code references:** [main package snapshot](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/package.json#L1). Full evidence: [branch catalog](reconciliation/branch-catalog.json), [PR history](evidence/pull-request-history.json).

- **Requirements:** For each catalogued source line that touches retained functionality, compare the branch patch/behavior to current main and the chosen candidate; inspect matched merged/closed PR decisions. Do not infer unimplemented status from branch ancestry or implemented status from a matched PR title. Recover useful closed/no-PR code only after ownership and compatibility review.
- **DoD:** No release-relevant branch remains ambiguous; dispositions cite commit/PR and concrete retained or superseded behavior. Unrelated histories and reference-only branches have documented exclusions.
- **Full functional verification:** Compare representative retained feature workflows before and after integration and assert no regression in behavior, permissions or persistence.
- **Test method:** Git ancestry plus patch/blob comparison, source/PR decision review and affected behavior suites; immutable release manifest records the outcome.

### [RECHECK-004.2] Recheck dirty state and remote delivery independently

**Code references:** [ROX main source](https://github.com/rox-one/rox-one/blob/f63294ba4fffa7238b46b24e918925a313ad0b12/package.json#L1).

- **Requirements:** Capture current source/worktree/PR state at delivery; verify canonical remote commit and documentation content separately from local checks. Preserve ongoing product changes and distinguish audit publication, application merge, signed builds and deployed production.
- **DoD:** Published ROX branch/PR and exported artifacts have verified content/commit identity; active worktrees retain their existing changes; no product merge or production deployment is asserted without its own evidence.
- **Full functional verification:** Read the published docs and JSON from the canonical remote, validate pinned links and compare artifact checksums; inspect live worktree status and final release evidence boundaries.
- **Test method:** Remote SHA/blob readback, local documentation integrity gate, archive checksum, Git status verification and final source/evidence manifest review.

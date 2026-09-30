# Project roadmap recovery receipt — 2026-09-30

## Status and source

This isolated branch recovers the orphan implementation associated with [PROJECTS-01 / #1194](https://github.com/rox-one/rox-one/issues/1194). The persistence and autosave repair is implemented and locally verified. The full issue remains open: this is a draft feature delivery with explicit integration and native acceptance gates.

| Item | Bound source |
|---|---|
| Recovery checkout | `/Users/t/Projects/rox-roadmap-recovery-20260930` |
| Recovery branch | `fix/roadmap-recovery-20260930` |
| Original checkout / branch | `/Users/t/Projects/rox-one-wt-proj` / `feat/project-roadmap` |
| Original feature | `481e5240096efd43adf29ac47cc0ddb45c0e635d` |
| Original tests / repair baseline | `40391c087a255118ea475ea09039f03e301b64c8` |
| Merge base with observed main | `c6841b85bddeb8f1bc76df57bc2195062504e081` |
| Audited main | `f63294ba4fffa7238b46b24e918925a313ad0b12` |
| Worker | `/root/repo_audit` |
| Independent reviewer | `/root/terminal_history`; root retains integration and remote delivery |
| Dispatch attempt | `73250c1fa8df794fd1df119fd248912f` |
| Dispatch packet hash | `1094485fe67b5303fbb4b54ce2a781435f8d949c3b14c7f9182918a12a3012e1` |

The original feature branch remains clean and its HEAD is unchanged. The recovery source uses an isolated worktree. Its ignored `node_modules` symlink borrows the original feature checkout's installed dependencies; no dependency install or lockfile mutation occurred. Active compound and September worktrees were read for ownership/conflict evidence and were not edited.

The final local commit and revision-bound file hashes are recorded in the parent handoff receipt; this document is part of that commit. No remote branch, PR, merge, native application launch or package installation is claimed by this worker.

## What changed

1. `loadProjectRoadmap` returns a SHA256 receipt for the exact canonical bytes, including corrupt bytes; a missing file returns `missing`. Read failures other than absence propagate.
2. `saveProjectRoadmap` accepts an optional `expectedRevision`, or the revision carried by the loaded roadmap. A mismatch stops before backup, JSON or Markdown mutation. Invalid observed tokens are refused. Legacy inputs without a token retain their existing last-write behavior.
3. Cooperating processes use an exclusively created `roadmap.json.lock` around read/compare/replace. A busy lock is refused and retained. Normal success and exceptions close and remove this writer's lock.
4. A corrupt JSON backup is created exclusively from the exact observed bytes. An existing backup or other backup creation failure stops the canonical overwrite. The prior backup remains intact.
5. The projects directory is fenced to the resolved workspace root; project and roadmap symlinks cannot escape their respective resolved directories. Workspace aliases themselves are resolved as the authorized entry point.
6. The actual `ProjectInfoPage` read/save caller uses an ordered queue whose revision advances only after an acknowledged save. The caller retains newer edits, fences late responses from an old scope, refuses saves after a failed read, clears old project content during a new read, and flushes route cleanup using the captured old scope and existing capability gate.

The token is response metadata and is omitted from canonical JSON. Canonical JSON uses the existing atomic temporary-file replacement helper. Markdown remains a derived, best-effort mirror. No new transport API, schema migration or authorization subsystem was introduced.

## Verification

Environment: macOS arm64. All tests used the parent-pinned Bun **1.3.14 (0d9b296a)**:

```sh
/Users/t/Projects/archive/rox-remaining-20260930/native-ui-20260930/profile/toolchain/bun/1.3.14/bun-darwin-aarch64/bun test packages/shared/src/projects/__tests__
```

Observed final source result: **28 passed, 0 failed, 120 assertions across four files**. The existing fourteen roadmap/domain/storage tests still pass alongside fourteen recovery and caller tests.

| Scenario | Method / observed result |
|---|---|
| Stale second writer | Real canonical/Markdown filesystem bytes retained after conflict |
| External edit with unchanged updatedAt | Exact byte revision detects the edit and refuses stale overwrite |
| Two concurrent processes | Two actual Bun processes released from one readiness barrier with one revision; exactly one succeeds, loser is busy/conflict, stale retry is refused |
| Backup creation failure | Real exclusive-create collision with an earlier backup; corrupt canonical and earlier backup byte-identical afterward |
| Busy lock | Existing lock retained and no canonical file created |
| Missing, normal and corrupt reload | Exact read/save receipts match actual file SHA256; recovered backup matches original corrupt bytes |
| Legacy compatibility / malformed token | Legacy unversioned overwrite works; invalid present token refuses mutation |
| Path escapes | Traversal, project symlink, canonical symlink and escaped projects-directory symlink refused; external JSON/Markdown retained |
| Actual autosave ordering | TypeScript AST extracts the actual hook callback; real storage behind the simulated RPC boundary; second call waits for the first ACK and persists the newer edit using its revision |
| Actual caller failure / late old ACK | Draft retained on refusal; old project's delayed receipt does not alter new project's state |
| Actual failed read | Real extracted load/update/flush callbacks clear old content, retain later input and the visible error, do not arm a writer or debounce; no save invoked |
| Actual route cleanup | Captured old workspace/project saves its pending edit; new project's JSON is absent and debounce cleared |
| Missing acknowledgement | Queue retains its observed revision after refusal or missing receipt |

The hook extraction checks real source callbacks and the persistence boundary. It does not exercise React lifecycle scheduling, installed Electron, visual state, focus, keyboard controls or application restart. Those remain native gates.

### Independent review

`/root/terminal_history` accepted the bounded persistence/autosave repair after independently running the pinned four-file suite (28/28, 120 assertions), both independently designed edge probes and whitespace validation. The hash-bound review artifacts are `/tmp/rox-roadmap-independent-review-20260930.md` and `.json`. The tracked source diff hash is `a397e25dcf356b32a64860fcb33202e05a5e65c55f82ba2fd1e5d74e430d84bd`; the JSON receipt additionally binds all four changed source files and both added test files. No outstanding blocking finding remains within this repair scope. Full #1194, native UI, shared entity integration and ACL remain unaccepted.

### TypeScript and diff checks

The complete shared and Electron TypeScript checks were run on the original baseline and the isolated recovery checkout using the same installed dependency tree. Both commands exit 2 on existing errors outside the changed roadmap paths:

- shared: 17 diagnostics; original and recovery logs byte-identical;
- Electron: 51 diagnostics; original and recovery logs byte-identical;
- no new diagnostics in roadmap storage/domain/tests or `ProjectInfoPage`;
- `git diff --check` passes.

Examples of baseline diagnostics: meeting-conation receipt types, meetings navigation contract, voice fetch/Blob types, unrelated extraction/context-budget tests and existing RPC nullable fields. These failures are not counted as a passing global gate and are not modified here.

### Before / after and failure history

- The six initial storage regressions failed against the old implementation: no revision, stale overwrite, external edit overwrite, best-effort corrupt backup overwrite, busy lock ignored and escaped path access. See `rox-roadmap-red-storage.log`.
- The actual old autosave callback invoked two RPC saves before the first ACK; the new ordering test failed with expected 1 / received 2. See `rox-roadmap-red-caller.log`.
- An initial test harness attempt using `Bun.Transpiler` emitted no arrow-expression program and produced a syntax error. The harness was corrected to `TypeScript.transpileModule`; only the subsequent actual callback failure was used as defect evidence.
- Independent edge probing found that the whole `projects` directory could escape via a symlink, even though each project was inside that directory. The real escaped-directory regression first failed, then passed after fencing the directory to the resolved workspace root. See `rox-roadmap-red-projects-symlink.log` and the independent edge-probe receipt.
- A second independent actual callback probe found that editing after a failed read left the interface claiming Saving without an armed writer. The actual load/update/flush regression reproduced it; the repaired callbacks retain the local edit and visible error while refusing saves. See `rox-roadmap-red-failed-read-state.log`.

| Local evidence file | SHA256 |
|---|---|
| `/tmp/rox-roadmap-red-storage.log` | `181fbd334c2c759c353116da16bd6af69c25587cfb30f317aebd7ba2ff82c49f` |
| `/tmp/rox-roadmap-red-caller.log` | `85340129c82cf2a34b3ca1c774cd41c59efba14eecc03a52eee034f7db680f69` |
| `/tmp/rox-roadmap-red-projects-symlink.log` | `c185885a1b97c66da09c92226767b4e0907a0516d75daf506647f15061b8242b` |
| `/tmp/rox-roadmap-red-failed-read-state.log` | `01fe8c7a6bfdf3eb3e3e9dee6e449a4fd5fd1ec318422fff69d440643a739686` |
| `/tmp/rox-roadmap-green-final.log` | `cf5861b894de4e72cab86b335ae209af6756a59f29c58d235e58062760018289` |
| `/tmp/rox-roadmap-typecheck-shared.log` and baseline counterpart | `58f8c89435560851c4ab2469b9b178647cd46196deff6a68bd9dfacae65932eb` |
| `/tmp/rox-roadmap-typecheck-electron.log` and baseline counterpart | `ab2b0d0692294205221aabfea1bed2156216de35f0ba57f2ab08e1a56c103047` |

Temporary fixture data and child writer scripts are removed by test cleanup. The listed logs and review/contract artifacts are intentionally retained for parent integration.

## Integration and remaining #1194 acceptance

The original feature implements one project canvas with goal/outcome, criteria, inputs, milestones/timeline, requirements, tasks and AI preview helpers. Source existence and unit tests do not accept all requirements of the September issue.

| Requirement / gate | State and next owner |
|---|---|
| Persistence CAS and backup refusal | Locally verified by this repair; integrate the new caller and storage together |
| Conflict reload/compare/merge affordance | Generic existing localized save failure retains input; dedicated conflict recovery UI is still pending native/product integration |
| Canonical shared entity refs / project owner / revisions | DATA-01 #1212 and SHARED-01 #1160 are required; opaque file hash is a local persistence fence, not acceptance of that shared contract |
| Source/actor/tenant ACL | Existing Projects RPC uses workspace lookup and Rox2 capability gate; `_ctx` is unused for roadmap authorization. Full actor/tenant source authorization and denied-input export/AI negative cases remain unverified; no competing ACL layer added |
| AI authorized provenance / accepted linked drafts | Original preview code must be checked against real selected inputs, cancellation, accept and duplication behavior in native UI |
| Linked task identity / real progress aggregation | TASKS-01 integration and stable relation semantics remain required |
| Delete/archive retention / transactional project lifecycle | Not implemented or verified by this repair |
| Keyboard, focus, narrow viewport, reduced motion | Native verification pending |
| Installed restart and reload | Not launched or verified by this worker |
| Full shared/electron typecheck | Existing baseline failures remain; no new diagnostics from this repair |
| Remote validation and PR delivery | Root owns delivery; preserve draft status until integration/native gates pass |

### Concurrent owner boundary

The compound owner and September owner previously changed `ProjectInfoPage.tsx`; the September owner also changed shared projects exports/types. Their callers must be compared when integrating the feature. This branch does not patch those worktrees or replace their changes. At the read-only comparison, the September source HEAD was `74506d7d02ac70a0af3afca3fad135cc1236f3e0` and the caller path was clean; the compound caller's latest commit was `4b64b6f8489c1865e56dfe77145a3e6057f0bb39`. These worktrees are active and may advance.

Do not cherry-pick the renderer caller blindly over an active source union. Root should review the feature's two original commits plus the isolated repair, preserve caller/export changes and perform a native gate on the integrated revision. The repository audit is `/tmp/rox-repo-audit-20260930.md`.

## Known local persistence limits

- Old unversioned callers preserve compatibility and can still overwrite newer state. The repaired renderer always carries its read receipt; other integrations should migrate deliberately.
- The lock serializes cooperating implementations. Direct external writers can change a file between comparison and replacement; symlink replacement races by an external actor are not fenced.
- A crashed writer can leave a lock. Refusal preserves data; an owner must verify there is no live writer before removing that specific lock. No automatic lock stealing was added.
- Atomic rename protects ordinary write replacement; this patch does not claim fsync/power-loss durability or a transaction spanning JSON and Markdown.
- A response lost after a successful commit may leave a local draft with an old token; retry is refused rather than silently replayed. Reload/compare is the pending product recovery path.

Root retains the requested outcome, issue acceptance, native verification and authorized remote delivery.

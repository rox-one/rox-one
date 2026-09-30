# Cloud core baseline repair plan

| Task | Owner | Depends on | Output | Verification |
| --- | --- | --- | --- | --- |
| C1 Reproduce and trace failures | cloud_recovery | Base revision | Root causes and caller inventory | Existing two-file regression run |
| C2 Add adversarial and clock tests | cloud_recovery | C1 | Credential and Things tests | Observe meaningful failures before source edits |
| C3 Repair shared locator validation | cloud_recovery | C2 | `credential-types.ts` | Registration, provider update, attachment and frozen locator tests |
| C4 Add a backward compatible task clock | cloud_recovery | C2 | `store.ts`, Things fixtures | Explicit clock and two argument behavior tests |
| C5 Verify and document | cloud_recovery | C3, C4 | `docs/cloud-core-validation.md` | Focused tests, complete core suite, affected package typecheck and diff checks |
| C6 Commit and hand off | cloud_recovery | C5 | Local commit and checkpoint | Clean assigned worktree, commit content, evidence hashes |
| C7 Integrate and deliver | lead /root | Reviewed C6 | Authorized Git / Cloud result | Lead review and delivered revision verification |

## Decisions

1. Keep validation in the existing shared `validateLocator` boundary. `attachCredentialRef` already calls `CredentialRefRegistry.prototype.register`, so duplicating validation there would miss direct registry callers and provider updates.
2. Validate property descriptors before reading locator values, so getters cannot run. Enumerability and data-property checks do not require writable or configurable fields; frozen records remain supported.
3. Use an optional `now = Date.now()` argument for `setWhen`. Existing renderer callers retain their behavior; fixed-clock tests supply their own reference date.
4. Use the verified Bun 1.3.14 executable from an existing toolchain without changing its owner profile. Dependencies are installed only in this worktree with a frozen lockfile and lifecycle scripts skipped.

## Progress

- C1 complete: two locator failures plus one calendar failure reproduced on main with Bun 1.4.2; roots traced to locator descriptor/prototype checks and `setWhen` mixing fixture time with `Date.now()`.
- C2 complete: Bun 1.3.14 red run recorded 46 passes and 9 failures across 55 tests, including accessor and explicit-clock failures; frozen locator and two argument API controls passed.
- C3/C4 implemented: preflight plain-object/property descriptors in the shared locator validator; optional `setWhen` clock defaults to `Date.now()`.
- C5 complete for the three failures: focused tests 55/55 and complete core suite 815/815 with Bun 1.3.14; 13 package typecheck diagnostics exactly match the base revision.
- C6 complete: the bounded repair was committed before the lead-authorized typecheck follow-up.

## Core typecheck follow-up

| Task | Owner | Depends on | Output | Verification |
| --- | --- | --- | --- | --- |
| CT1 Review existing candidate hunks | cloud_recovery | C6 committed | Provenance and semantic review | Read active September diffs without editing them |
| CT2 Reproduce queued verification gap | cloud_recovery | CT1 | Two verified-state regressions | 3 pass / 2 fail before source edit |
| CT3 Port 13 narrow repairs | cloud_recovery | CT2 | Calendar assertion, canonical normalization, queued guard | Targeted tests and zero core TS diagnostics |
| CT4 Commit follow-up and hand off | cloud_recovery | CT3 | Second local commit, evidence | Full core suite and lead review |

- C6 complete: `f8982a04b11169ed88981879ff7130397e792761`, assigned worktree clean at first handoff.
- CT1/CT2 complete: lead assigned independent port into this isolated main baseline; active September union remains owned by its native-boundary worker. Guard regression failed for `receipt_verified` and `readback_verified` as expected.
- CT3 implemented: only the 13 selected candidate hunks and related queue regression were ported. No unrelated candidate features or suppressions.
- CT3 verified: focused calendar/platform/meeting tests 218/218, full core suite 817/817, and core typecheck exit 0 with zero diagnostics.
- CT4 complete: follow-up `01889b4a43a2ce4f730d3109b49750a0fbde4db8` reviewed and integrated into this main-based branch; the active September candidate worktree remains unchanged.

---

# CI recovery execution plan

| Task | Owner | Dependencies | Verification | State |
|---|---|---|---|---|
| Bind isolated baseline | cloud_recovery | Parent allocation | Absolute root, branch and clean base `f63294ba` | Complete |
| Verify hosted runner and billing | cloud_recovery | Current primary docs; public repo readback | Supported `macos-15`; public standard runner billing; queued current jobs | Complete |
| Repair runner and version configuration | cloud_recovery | Evidence above | Both YAML files parse; `validate:ci` and job identities retained; frozen Bun1.3.14 | Complete |
| Replace placeholder with built runtime proof | cloud_recovery | Own dependencies and three real builds | Built lifecycle2/2; related source/WebUI/transport23/23; missing-artifact negative controls fail | Complete |
| Typecheck and baseline comparison | cloud_recovery | Installed TypeScript5.9.3 | Same eight existing server diagnostics; no new test diagnostics; plain baseline `validate:ci` stops on13known core errors | Complete |
| Root review and integration | root / terminal_history | Local receipt commit; core/bridge/typecheck fixes | Original code reviewed; documentation combined; integrated built gate verified | Complete locally |
| Hosted delivery receipt | root / terminal_history | Authorized push/PR after review | Owned CI alias and lifecycle jobs pass at6cf191dd; CodeQL Actions0findings; unrelated checks remain separate | Complete for scoped jobs |

The original isolated workflow proposal and local runtime proof are complete. Its historical baseline diagnostics remain in the original receipt; the current combined integration result is recorded below. Hosted execution remains a separate delivery gate.

## Combined main-based integration

| Task | Owner | Dependencies | Verification | State |
|---|---|---|---|---|
| Integrate core and CI | terminal_history | Reviewed f8982a04,01889b4a,da74aa13 | Main base; preserve both docs sections; no application merge conflict | Complete |
| Run actual comprehensive gate | terminal_history | Frozen Bun1.3.14 install | First failure retained; full final run exit0; unchanged inputs bound to final source | Complete |
| Repair observed baseline gate failures | terminal_history / cloud_recovery | Exact failing diagnostics/tests/lint | Narrow main-compatible repairs, focused tests, unchanged locale values; no suppressions/gate removal | Complete |
| Verify combined built runtime | cloud_recovery / terminal_history | Three real builds | Rebuilt combined bundle; strict built smoke4/4; focused server175/175 and memory6/6 | Complete locally |
| Review and record evidence | repo_audit / root | Frozen bounded diff and final logs | Independent Standards and Spec/runtime acceptance; tracked hash-bound receipt | Complete locally |
| Deliver new draft PR | terminal_history / root | Root selected separate combined branch | PR#1317 published; remote6cf191dd verified; final read-only CI alias and PR/push lifecycle jobs pass | Complete |

- Spec review correction: the candidate Pi reasoning deletion regressed existing main Responses support because its local API union was stale. Reused the canonical type, restored registration behavior and added actual-callback tests. The reviewer independently reproduced main=true, preliminary candidate=false and corrected=true for Responses, with Completions unchanged.
- Lifecycle review correction: explicit graceful shutdown now rejects a child that had already exited before the request, including exit zero. Separate cleanup retains rejected-startup support. Both original built-runtime cases and actual already-exited zero/17 controls pass; reintroducing the old early return fails both controls. Product runtime is unchanged.
- The final zero/17 child fixtures use both fresh config aliases, so Bun preload cannot reach the user's config. A reproduced hosted macOS Vite heap failure is addressed only with a4096MiB compiler/build heap in the WebUI build step. No source, assertion or command is disabled.
- Hosted PR#1317 lifecycle passes4/4 with37assertions on the delivered source. Its first comprehensive hosted run reproduces Electron Node22 TypeScript heap exhaustion near2042MiB (SIGABRT134); only the unchanged validation step now receives a4096MiB Node heap. Preserve this failed run and verify the amended hosted result before completion.

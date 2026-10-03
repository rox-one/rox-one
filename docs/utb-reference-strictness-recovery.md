# UTB-01 reference validation recovery — 2026-09-30

## Revision and accepted boundary

This follow-up starts at exact draft #1314 head `a428eb42c5681adb15d97dcacc88ce45cef7e7a4` on `feat/unified-tables-baserow-20260930`. Its separate branch is `fix/utb-reference-strictness-20260930`. The intended PR base is that feature branch. The original branch and original unified-tables program documents remain unchanged.

Three source/test paths are frozen by `utb-reference-strictness-evidence.json`. Their source digest is `c45ecf487a2e2e5998e211de83f8fa9cc68952beb6f952e8172595c4d5274401`. Independent Spec and Standards review accepted the exact diff `e596d208b82239f4d5aaff6466d089d98683f11c701fbcfd42611145e6824905` and independently reran Bun72/0 with no open findings. Review receipt SHA-256: `3e8dc9bdbd2cbe0412fa2f77d28a464a9d5f1882c84c22f0d998775ed3971021`. Publication remains a separate gate in [plan.md](plan.md).

The published direct encoder/factory accepted unknown nonenumerable or symbol properties and silently dropped them. Allowed own accessors could execute while producing a reference or positive capability evidence. The repair validates all own keys of each v1 record through inert data descriptors. Unknown keys and accessor descriptors fail with the existing `invalid-shape` code. Known nonenumerable data survives normalization. Capability evidence accessors supply no positive evidence and are not invoked.

Accepted JSON v1 wire data, identity/query keys, host kinds, presentation limits and byte limits retain the existing behavior. Opaque future JSON versions retain their original raw string and remain unavailable. Availability is local metadata; production owner ACL enforcement is still required for every actual read or command. This patch introduces no I/O or transport operation.

## Executed checks

Pinned local environment: macOS arm64, Bun **1.3.14**, Node **22.23.2**, TypeScript **5.9.3**. No install or lockfile change was performed. External dependencies were borrowed from the frozen CI recovery install with matching lockfile SHA; workspace package links point at this exact checkout. No candidate source from the CI recovery branch was substituted.

| Check | Observed result |
|---|---|
| Original two test files at exact published a428 head | Bun 54/0; Node22 54/0 |
| New adverse tests before source repair | 54 pass, **18 fail**, exit1; failures are semantic assertions |
| All three actual test files after repair | Bun **72 pass, 0 fail**; Node22 **72 pass, 0 fail, 0 skipped** |
| Mutation in a separate temporary copy: restore old direct object return and `Object.keys` checking | **58 pass, 14 fail**, exit1; new codec assertions reject the mutation |
| Narrow TypeScript closure: four real modules and all three real test files, using canonical core options and real imported repository types | Exit0 |
| Additional typed consumer of `@rox/core/bases` | 0 diagnostics; real `rox2/platform-contract.ts` included, no repository type stub |
| Actual Bun package export and round trip | Resolves to this checkout's `src/bases/index.ts`; valid round trip |
| Package metadata compatibility | 25 previous export targets unchanged; sole original feature addition `./bases`; other metadata and lockfile unchanged |
| Full core compiler after repair vs original main f632 baseline | Both exit2 with **13 identical diagnostics**, byte-identical logs |
| Shared and Electron compiler at original a428 head vs f632 baseline | Both exit2; **17** and **51** identical diagnostic records, no added diagnostics |
| Whitespace | `git diff --check` exit0 |

Electron diagnostic comparison normalizes only the checkout prefix in diagnostic locations and sorts complete diagnostic blocks. Diagnostic text and continuation lines are retained. Shared logs are byte-identical. The baseline tree uses f632 core/shared/Electron inputs; remaining linked workspace inputs are byte-identical between f632 and a428. The new repair changes no shared or Electron input.

The adverse cases cover hidden fields at the root and nested reference/host/mode/presentation records; unknown symbols; root and nested getters; known hidden presentation data; and source/runtime/grant/host-mode capability getters. The existing 54 tests retain JSON/future version, cross-workspace, limits, reference identity and per-capability denial assertions.

Reproduce the direct runtime gates from the checkout:

```sh
bun test packages/core/src/bases/__tests__
node --experimental-strip-types --test packages/core/src/bases/__tests__/*.test.ts
bun node_modules/typescript/bin/tsc --noEmit -p packages/core/tsconfig.json
```

The last command currently returns the retained 13 baseline failures; it is not a passing full-core gate. Exact focused-config, virtual consumer, mutation input, all attempts and hashed logs are retained in the session recovery evidence archive. Initial verification setup omissions were fixed without source suppressions: the temporary config explicitly binds the installed Bun type root, and the temporary f632 comparison tree includes its original session-tools/scripts inputs. Those failed attempts remain in the archive.

## Remaining program gates and UTB-02 dependency

This bounded repair does not close #1296 or complete #1295. Full downstream validation still requires integration with accepted main core/CI repairs; native table rendering, host persistence, source authorization, two-client behavior and full program acceptance were not run by this unit verification. The original sixteen later UTB work packages remain planned; this recovery launches none of them.

Current issue #1297 (UTB-02) depends on #1296, #1231, #1235, #1243, #1249, #1279 and #1283. Its creation service must receive the authenticated actor and host/source refs, stable operation/idempotency identity and expected host revision; persist the canonical Base definition; attach the same reference through host CAS; and return authoritative readback. Crash/retry/restart must reconcile the existing creation intent rather than create duplicate Base identities or overwrite parallel document changes.

The exact published a428 `core/bases` tree contains only reference and capability metadata modules. It supplies no durable BaseDefinition or creation service. Issue #1235 still describes persisted Base/config revisions and separate personal preferences as `SPEC_PUBLISHED / PLANNED_NOT_EXECUTED`; #1283 describes actor-scoped Doc/Base embed context with the same status. Those source-owner/ACL/grid/query/host prerequisites need reviewed implementation and runtime receipts from their existing owners before UTB-02 product work can claim readiness. Note, Doc and standalone origins must eventually share one service and one canonical identity, with actual native and second-client restart checks.

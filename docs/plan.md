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
- C6 in progress: commit this bounded repair before the lead-authorized typecheck follow-up.

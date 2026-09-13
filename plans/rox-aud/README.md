# ROX-AUD program (issue #342)

**Charter issue:** [#342](https://github.com/rox-one/rox-one/issues/342)
**Continues:** [#315](https://github.com/rox-one/rox-one/issues/315) / `plans/rox2`
**Contract seam:** `packages/core/src/rox2/platform-contract.ts` (extend, do not fork)

`ROX2-001..200` lives in `plans/rox2`. `ROX-AUD-001..200` are audit cards. **The same numeric suffix is not the same card.** Do not import the remaining audit cards as a second competing backlog.

## Artifacts

| File | Role |
|---|---|
| `crosswalk.ts` | Same-suffix relations + GitHub issue rows for #320–#342 |
| `__tests__/crosswalk.test.ts` | Never-equivalent suffix rule + issue mapping |
| `packages/core/src/rox2/platform-contract.ts` | Result / identity / event / actor-grant semantics |

## Relations

Allowed values: `equivalent` / `extends` / `supersedes` / `independent` / `unmatched`.

Same-suffix pairs in this repo:

- `ROX-AUD-000` **extends** `ROX2-000` (parent execution vs program envelope).
- `ROX-AUD-001..200` are **independent** of `ROX2-001..200`.
- No same-suffix pair is `equivalent`.

## Contract semantics (not a second contract)

- `queued` / `simulated` / `fixture` are not claimable live. `isClaimableLive(queuedResult(...)) === false`.
- `Rox2EntityRef` needs `revisionId` **and** `accountNamespace` before mutating lineage (`isRevisionedEntityRef`).
- `Rox2Event` needs `causationId`, `correlationId`, and `aggregateRevision` before it is an auditable product event.
- `entity.permissions[]` is a catalog. `authorizeRox2Action` requires an actor-scoped grant.

## What this closeout does not claim

Live Conation, Drive, Mail, CRM, or a finished 200-card product. Remaining unmatched AUD cards stay unmatched until a later owner imports them one-by-one against `plans/rox2` by meaning, not by number.

# modules/acl — Postgres ACL fact source (W1-04, #1501)

`PostgresAclRepository` (`repository.ts`) backs the pure ACL engine
(`packages/core/src/acl/evaluate.ts`) with the W1-05 (#1502) tables. SQL lives
in `queries.ts`; every read is scoped to the evaluating workspace. The module
never writes: share / privacy writers belong to the owning wave-2 modules and
must bump `workspace.policy_epoch` in the same transaction (see the
EPOCH-BUMPING FACTS list on `AclFactSource`).

## Share stores

- `acl_entry` / `resource_policy` — the generic grant and preset stores for
  every resource type.
- **`calendar_member` is the canonical calendar share store; `acl_entry` is
  also honoured.** `entries()` turns `calendar_member` rows into calendar
  grants (subjects principal / space / channel / workspace; roles owner →
  manager, editor → editor, viewer → viewer, free_busy → free_busy). Channel
  subjects go through the engine's chat join rule like any channel grant.
  Writers of `calendar_member` must bump the policy epoch.
- Chat / space membership is synthesised from `chat_member` (via `'chat'`),
  and counts only where the join rule allows it (`chatEntriesCount`).

## Personal content

Docs with no folder / wiki / space / parent_ref / public_token, user folders,
principal calendars and loose tasks are owner-only secret unless shared with a
group in a way that actually gives access (a workspace / space grant with a
role ≥ viewer — in `acl_entry`, or in `calendar_member` for calendars — a
workspace preset with a role, or a doc's unexpired link preset). A free/busy
grant leaves a calendar secret (the workspace owner gets no bypass) while the
grantees still see free/busy.

Task lists with `share_mode` `private` or `members` (user, project or space
owned) are secret: only their own grants / members reach them and their tasks.

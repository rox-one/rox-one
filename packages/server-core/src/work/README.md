# Work store, reference handlers, MIG-04/05 (W1-06, #1503)

Wave-1 groundwork for the unified work domain. Wave-2 module packages replace
the reference handlers module by module; the storage formats here are the
ones they inherit.

| Path | Role |
| --- | --- |
| `local-work-store.ts` | JSON-per-record store at `{workspaceRoot}/work/<collection>/<id>.json` (`{id, collection, revision, schemaVersion, record, deleted?}`), dir 0700 / file 0600, tmp + rename writes, CAS `put` (`null` = create only), verbatim `write` for migrations. |
| `reference/` | One generic reference handler per catalogue command (CRUD-level, ACL already checked by the executor's authorizer stage). |
| `migrations/goals-migration.ts` | MIG-04 (`okr.json` → cycle / goal / target / check + `aligned-to` link) and MIG-05 (`roadmap.json` milestones → `milestone`, `taskIds` → task placement). Gated by `goals.v1`. |

Schemas live in `@rox/shared/domain` (one `schema.ts` per module; `COMMAND_PAYLOAD_SCHEMAS`
covers every non-system catalogue command, `ENTITY_SCHEMAS` the entity shapes).
The PersonalTask v3 store (MIG-01/02/03) is in `src/tasks/personal-persist.ts`.

## Reference handlers

- Bound through `COMMAND_MODULES` (`commands/registry.ts`): `domain-schemas` binds the payload
  schemas, `reference-handlers` binds a handler to every command that has none. It is listed
  **last**, so a wave-2 module listed before it wins for its commands.
- `reference/specs/*.ts` describe each command with small op combinators (`ops.ts`):
  `create`, `update`, `transition`, `softDelete`, `childCreate/Update/Delete` (a child of
  another parent is `NOT_FOUND`), `assoc`, `setting`, `addLink/removeLink` …
- Every handler writes through a `RecordBackend` chosen from the executor transaction handle:

| Handle | Backend | Where records go |
| --- | --- | --- |
| `memory` | `MemoryRecordBackend` | process memory (tests) |
| `sqlite` (local authority) | `LocalRecordBackend` | `task` → PersonalTask v3 store (the Tasks UI sees them; a `personalTasks:changed` push follows), `entity-link` → `work/links/` + the W1-02 link index while `entities.links.v1` is on, everything else → `work/<dir>/` |
| `postgres` (workspace authority) | `PostgresRecordBackend` | W1-05 table rows when the collection maps to a single-uuid-PK table; other collections are `reference.record_written` snapshot events in `domain_event` (no new DDL) |

- Ids: payload `id` when given, otherwise `sha256(workspace, commandId, salt)` shaped as a uuid,
  so a retried command finds its own effect (`lastCommandId` on every record).
- Events: one domain event per command (catalogue event type where one fits), payload
  `{reference: true, command, collection, id, revision, changes}` — field names only.
- Errors: missing target / wrong target kind / schema-constraint violation → `VALIDATION`;
  missing record or FK → `NOT_FOUND`; handler-level rules (sender-only edit, host-only call
  controls, posting policy, own access request) → `FORBIDDEN`; stale `expectedRevision` or an
  existing id → conflict receipt; expired upload session / access request → `VALIDATION`.
- `commands.batch` only records the batch; nested execution is W1-15.

## MIG-04 / MIG-05

Runs once per workspace and process on the first local command while `goals.v1` is on
(`ensureGoalsMigrated`), or explicitly via `runGoalsMigration`. Ids are deterministic and an
existing record is never overwritten, so a re-run reports everything as `unchanged`. The report
is written to `work/.migrations/mig-04-05.json`. Source files are only read.
`readProjectOkrLenient` (`@rox/shared/projects`) imports OKR files the strict reader rejects,
keeping every usable cycle / objective / key result and listing what it skipped.

## Tests

- `__tests__/reference-handlers.test.ts`: every catalogue command runs through its reference
  handler (memory); per-command VALIDATION / FORBIDDEN / UNAVAILABLE; scope, conflict, expiry,
  handler-level permission, idempotent replay.
- `__tests__/reference-local.test.ts`: the same scenario on the local SQLite authority.
- `apps/workspace-service/test/reference-handlers.pg.test.ts`: the scenario on PostgreSQL with
  the full W1-05 DDL (temp `initdb` cluster or `ROX_TEST_PG_URL`; skipped otherwise).
- `__tests__/goals-migration.test.ts`: MIG-04/05 fixtures, golden output, idempotent re-run,
  flag gate. Regenerate goldens with `UPDATE_GOLDEN=1`.

Rate limits and quotas are enforced by the W1-11 middleware stage, not by reference handlers.

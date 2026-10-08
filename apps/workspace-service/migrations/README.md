# Workspace-service migrations (unified DDL, W1-05)

Issue #1502 · unified spec **v2** (DATA-MODEL §12). 26 files land here; the 27th
(spec `40-tables.sql`, 9 tables) is owned by Unified Tables (#1295) and is **not
authored** in this package. It has no reserved slot: see "Adding a migration".

## Startup loading (always the full sorted set)

`loadWorkspaceBootstrapMigrations` (`src/server.ts`) reads **every** `*.sql` file in
this directory and sorts it with `compareMigrationNames` (numeric locale compare,
the same rule the migrator uses). Every start therefore applies, in order:

1. both `01-*` files,
2. `48-license-audit.sql`, **always**. Its DDL no longer depends on
   `licenseRegistryPath`; only the licence-registry *feature* stays conditional,
3. every `5NN-*.sql`.

Loading 48 only when a licence registry was configured was a trap: a database first
started without a registry would record `01, 01, 502…`, and enabling the registry
later would insert 48 into the middle of the history (`MIGRATION_ORDER_CONFLICT`).
Databases bootstrapped by the old loader upgrade cleanly: `01, 01` → `48, 502…552`
are appended, `01, 01, 48` → `502…552` are appended. The unified tables are
additive and stay empty while their feature flags are off.

`workspace-service:package` (root `package.json`) must list every file here; a test
enforces it.

## File numbering: spec number → 5NN on disk

`applyWorkspaceMigrations` (`src/database/migrations.ts`) sorts by name with a
numeric locale compare and requires the applied history to be an exact prefix of
the sorted list. Deployed databases have `01-domain-contract.sql` and
`01-local-auth-bootstrap.sql` applied (and `48-license-audit.sql` where a licence
registry was configured), so a literal `02-…`…`47-…` name would sort **before**
`48-license-audit.sql` and break every existing database (`MIGRATION_ORDER_CONFLICT`).

Every new file therefore keeps the spec's logical number as `5NN`:

| Spec file (DATA-MODEL §12) | On disk | Tables |
|---|---|---|
| `02-directory.sql` | `502-directory.sql` | user_profile, department, department_member, contact_star, external_contact, bot_app, contact_card (+ `principal.kind`) |
| `03-acl.sql` | `503-acl.sql` | acl_entry, resource_policy |
| `04-files.sql` | `504-files.sql` | file_object (incl. v2 ownership/size/storage/provenance/trash columns) |
| `05-events.sql` | `505-events.sql` | domain_event, command_receipt, realtime_cursor |
| `06-notify.sql` | `506-notify.sql` | notification, notification_pref, notification_email_batch |
| `07-search.sql` | `507-search.sql` | search_document, search_usage |
| `08-social.sql` | `508-social.sql` | entity_link, comment (incl. v2 thread/kind/mentions columns), reaction, subscription |
| `09-spaces.sql` | `509-spaces.sql` | space |
| `10-docs.sql` | `510-docs.sql` | doc (incl. v2 daily/event_ref/suggest columns), doc_yjs_update, doc_snapshot |
| `11-drive-wiki.sql` | `511-drive-wiki.sql` | folder, folder_item, drive_link, wiki_space, wiki_node, drive_recent, drive_favorite |
| `12-im.sql` | `512-im.sql` | chat, chat_member, message, message_flag, chat_pin, chat_top_notice, chat_announcement, chat_tab, chat_label, chat_label_item, chat_member_event, message_draft (+ deferred `space` FKs) |
| `13-identity-lifecycle.sql` | `513-identity-lifecycle.sql` | invitation, agent_binding (+ `principal`/`workspace`/`workspace_member`/`chat` ALTERs, bot seed) |
| `14-agent-governance.sql` | `514-agent-governance.sql` | agent_grant, approval_policy, approval_request, standing_approval, rate_limit_policy, audit_log |
| `15-automation-rules.sql` | `515-automation-rules.sql` | automation_rule, rule_execution |
| `16-drive-quota.sql` | `516-drive-quota.sql` | drive, storage_ledger, file_version, file_preview, upload_session (+ deferred `file_object` FK) |
| `17-collab.sql` | `517-collab.sql` | doc_suggestion, doc_view, calendar_member (FK added in 521) |
| `20-work-item.sql` | `520-work-item.sql` | work_item, work_item_member, work_item_user_state (incl. v2 `seen_at`), task_list (incl. v2 system_role/share_mode), task_section, task_list_group, task_in_list, task_status (+ status-set seed) |
| `21-calendar.sql` | `521-calendar.sql` | calendar, calendar_event, event_attendee, room, freebusy_cache (+ deferred `calendar_member` FK) |
| `22-goals.sql` | `522-goals.sql` | okr_cycle, goal, goal_target, goal_check |
| `23-projects.sql` | `523-projects.sql` | project_member, milestone (+ `project` ALTER incl. `roadmap`) |
| `24-check-ins-reviews.sql` | `524-check-ins-reviews.sql` | check_in, review |
| `25-kpi.sql` | `525-kpi.sql` | kpi, kpi_entry, kpi_entry_edit, kpi_annotation |
| `26-templates.sql` | `526-templates.sql` | project_template |
| `30-vc.sql` | `530-vc.sql` | meeting_room, recording |
| `40-tables.sql` | — (no slot; lands as `553+`, see below) | owned by #1295 — do not author here |
| `51-workplace.sql` | `551-workplace.sql` | workplace_app, workplace_favorite |
| `52-mail.sql` | `552-mail.sql` | mail_account |

94 new tables here + 9 from #1295's tables file = **103** (DATA-MODEL §12 totals).
4 extended tables: `principal`, `project`, `workspace`, `workspace_member`.

## Adding a migration (#1295, #1314 and everything later)

A new file must sort **after the last file in this directory** (today
`552-mail.sql`, so `553-…` or higher), never in the middle. Because the applied
history must be an exact sorted prefix, a mid-sequence name breaks every database
that already applied a later file: `540-tables.sql` would fail once 551/552 are
applied, and `40-tables.sql` sorts before 48 and fails everywhere. #1295's tables
(spec `40-tables.sql`) and #1314's tables therefore land as the next free number
(`553-tables.sql`, then `554-…`), in whichever order they merge.

Append the new name to `LOCKED_MIGRATIONS` in `../test/migrations.unified.test.ts`
and to `workspace-service:package` in the same change. The static test fails if a
file sorts into the locked history or is missing from the package.

## Ordering inside the new set

Every FK / ALTER target exists earlier in sort order, except three documented
deferrals (child sorts before parent, so the constraint is added later):

- `space.chat_id / root_folder_id / wiki_space_id` → added at the end of
  `512-im.sql` (targets: `chat` in 512, `folder` + `wiki_space` in 511).
- `file_object.owner_drive_id → drive` → added in `516-drive-quota.sql`.
- `calendar_member.calendar_id → calendar` → added in `521-calendar.sql`.

Never edit `01-*.sql` / `48-*.sql`; their checksums are locked.

## Extensions (required database privilege)

`citext`, `pg_trgm` and `unaccent` must exist **once per database in the shared
`public` schema**. References are schema-qualified (`public.citext`,
`public.gin_trgm_ops`, `public.unaccent`) because the migrator locks `search_path`
to the migration schema: a plain `CREATE EXTENSION IF NOT EXISTS` would install
into the first-migrated schema and stay invisible to later ones.

Since the loader always applies the full set, `502-directory.sql` runs on the
first start of this binary against **every** deployment. It opens with a
preflight `DO` block that checks `pg_extension` / `extnamespace` per extension:

| State | Result |
|---|---|
| installed in `public` | nothing to do; no privilege needed |
| installed in another schema (e.g. `extensions`) | startup fails: *needs PostgreSQL extension "citext" in schema "public", but it is installed in schema "extensions"*. Hint: `ALTER EXTENSION … SET SCHEMA public` |
| missing | `CREATE EXTENSION … WITH SCHEMA public`; if the role cannot, startup fails: *…not installed and the service role could not create it: permission denied…*, with the privilege hint |

**Required privilege:** the service role needs `CREATE` on the database (all
three are *trusted* extensions on PostgreSQL 13+, so no superuser is needed),
**or** a DBA pre-installs them before the first start:

```sql
CREATE EXTENSION IF NOT EXISTS citext   WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
```

The startup transaction rolls back on a preflight failure, so nothing is
recorded and the next start retries cleanly. See also `../DEPLOYMENT.md`.

## FTS configs

`search_document.tsvector` is maintained by `search_document_refresh_tsv()`:
title via `russian` (weight A) + `english` (weight A), body via `simple`
(weight B). GIN on `tsv`, `pg_trgm` GIN on `title`. Query-side normalisation
may use `public.unaccent`.

## Seed rows (deterministic ids, `ON CONFLICT DO NOTHING`)

- System bot principal `00000000-0000-0000-0000-000000000b07`
  (`kind='bot'`, `status='active'`) — `513-identity-lifecycle.sql`.
- Canonical workspace-default status template (`pending`, `in_progress`,
  `done`, `canceled`) under the nil workspace
  `00000000-0000-0000-0000-000000000000` — `520-work-item.sql`.
  `task_status.workspace_id` intentionally has no FK so the template can exist
  before any workspace; workspace provisioning clones it per workspace.

## Key-query indexes

- Work map: `goal_space`, `goal_parent`, `goal_cycle`, `project_space`,
  `milestone_project`, `work_item_space`, `task_in_list_cover`.
- Chat feed: the `UNIQUE (chat_id, seq)` btree (`message_chat_seq`), scanned
  backward for newest-first pages. No separate feed index.
- Quick panels / backlinks (every lookup filters `workspace_id` first, see
  "Tenant scoping of keys"): `entity_link_to`, `entity_link_from`,
  `comment_by_resource`, `notification_unread` (`(principal_id, created_at DESC)
  WHERE read_at IS NULL`: unread newest-first without a sort).
- Review: `check_in_subject`, `check_in_pending_ack` (`(workspace_id,
  subject_type, subject_id, created_at DESC)` over unacknowledged published
  check-ins: the "needs your review" query for the subjects a reviewer owns),
  `goal_check_in_due`, `approval_request_pending`.

## Tenant scoping of keys

One database holds many workspaces, and a principal can belong to several, so
keys over free-text or client-supplied values are scoped:

- `acl_entry` `UNIQUE (workspace_id, resource_type, resource_id, subject_type,
  subject_id)`, `resource_policy` `UNIQUE (workspace_id, resource_type,
  resource_id)`, `acl_by_resource (workspace_id, resource_type, resource_id)`.
- `task_list_system_role_uniq (workspace_id, owner_id, system_role)` and
  `doc_daily_uniq (workspace_id, owner_id, daily_date)`: one backlog/inbox and
  one daily doc per user **per workspace**.
- `upload_session` and `storage_ledger`: `UNIQUE (drive_id, idempotency_key)`
  (a drive belongs to one workspace). `rule_execution`'s key is server-derived
  and stays global.
- `project_member`, `milestone` and `work_item` reference `project
  (workspace_id, project_id)`; `project_member`'s key includes `workspace_id`.
  `work_item_milestone_fk (workspace_id, milestone_id)` → `milestone`'s
  `UNIQUE (workspace_id, milestone_id)` is added in `523` (milestone sorts
  after `520`); `work_item_project` is `(workspace_id, project_id)`.
- Social (`508`): `entity_link_uniq (workspace_id, from_kind, from_id,
  relation, to_kind, to_id, COALESCE(role, ''))`, `entity_link_to
  (workspace_id, to_kind, to_id)`, `entity_link_from (workspace_id, from_kind,
  from_id)`, `comment_by_resource (workspace_id, resource_kind, resource_id,
  created_at)`, `comment_open_threads (workspace_id, resource_kind,
  resource_id)`, `reaction` `PRIMARY KEY (workspace_id, resource_kind,
  resource_id, principal_id, emoji)` and `reaction_covering (workspace_id,
  resource_kind, resource_id, principal_id)`, `subscription` `PRIMARY KEY
  (workspace_id, resource_kind, resource_id, principal_id)`. A principal in two
  workspaces can react to / follow the same resource id in both, and an
  `ON CONFLICT` upsert in one never rewrites the other's row.
- Personal free-text refs are per workspace: `contact_star` `PRIMARY KEY
  (workspace_id, owner_principal_id, starred_ref)`, `search_usage` `PRIMARY KEY
  (workspace_id, principal_id, kind, ref)` and `search_usage_rank
  (workspace_id, principal_id, score DESC)`, `drive_recent` / `drive_favorite`
  `PRIMARY KEY (workspace_id, principal_id, item_ref)`. These four tables carry
  a `workspace_id` column that the DATA-MODEL DDL does not list yet (spec follow-up).
- Lookup indexes over free-text refs or ids that are unique only per workspace
  (project ids: `project`'s key is `(workspace_id, project_id)`):
  `domain_event_subject (workspace_id, subject_kind, subject_id)`,
  `audit_by_target (workspace_id, target_ref)`, `file_object_source
  (workspace_id, source_ref)`, `task_list_owner (workspace_id, owner_type,
  owner_id)`, `milestone_project (workspace_id, project_id)`,
  `check_in_subject (workspace_id, subject_type, subject_id, created_at DESC)`,
  `review_subject (workspace_id, subject_type, subject_id)`.
- Deliberately global: `principal_email_uniq` and `user_profile.username`
  (identity across workspaces), `doc.public_token` (random), `event_id` /
  `audit_id` (uuids), `rule_execution.idempotency_key` (server-derived). Keys
  led by a globally unique uuid (`chat_id`, `doc_id`, `folder_id`,
  `calendar_id`, `drive_id`, …) are already tenant-scoped through that row.

## Rollback

Migrations are **additive only**: new tables, nullable-or-defaulted columns,
new indexes. There is no down migration by design.

- **Feature rollback** (keep this binary): disable the feature flags. No module
  binds these tables until its flag ships (all default OFF), so with flags off
  the package is inert and the tables stay empty.
- **Binary rollback is not possible after the first start.** That start records
  `01, 01, 48, 502…552` in `rox_schema_migration`. An older binary (current
  `main`) loads only `01` (+ `48`), finds history it does not ship and fails
  **every** start with `MIGRATION_HISTORY_MISSING`. The **only** way back to an
  older binary is to restore the **pre-upgrade snapshot** (taken before the first
  start of this binary) and lose every write since. Take that snapshot before
  upgrading.
- **No in-place corrections.** From the first start every file here is
  checksum-locked: editing a shipped file fails startup with `MIGRATION_CHANGED`.
  Any later DDL correction (index, constraint, column) ships as a **new
  `553+` file** (see "Adding a migration").

## Table ownership (one writer per table, PLAN §1.3)

directory → `502, 513(invitation)` · acl → `503` · drive → `504, 511, 516` ·
commands/bus → `505` · notify → `506` · search → `507` · social → `508` ·
spaces → `509` · docs → `510` · wiki → `511` · messenger → `512` ·
identity → `513` · agents → `513(agent_binding), 514` · automation → `515` ·
tasks → `520` · calendar → `521, 517(calendar_member)` · goals → `522, 524` ·
projects → `523, 526` · kpis → `525` · meetings → `530` · workplace → `551` ·
mail → `552` · collab → `517` · tables → `553+` (#1295).

## Tests

`../test/migrations.unified.test.ts` (static inventory/order/FK-target/553+
checks run without a DB; migrate-up runs against `ROX_TEST_PG_URL`, else a temp
`initdb` cluster from `initdb`/`pg_ctl` on `PATH`, else skip; real dot-configs are
never read). `ROX_TEST_PG_REQUIRED=1` turns the skip into a failure. Runs: (a)
empty DB, (b) `01 + 48` then the new files, (c) re-run no-op, (d) tampered
checksum → `MIGRATION_CHANGED`, old-loader upgrade paths (`01` only, `01 + 48`),
real `createWorkspaceServer` startup + restart, tenant-scoped keys and project
FKs, the extension preflight (role without `CREATE` on a fresh database → clear
error then success after a DBA pre-install; extension in another schema → clear
error; needs a superuser test connection, else that test logs and returns), plus
`EXPLAIN` index-use assertions on the key queries above (skewed seed + `ANALYZE`,
no `Sort` node, index definitions pinned).

Run with `bun run workspace-service:test` (or `bun test apps/workspace-service/test`).
CI runs them in the `workspace-migrations` job of `.github/workflows/ci.yml`
against a `postgres:16` service container.

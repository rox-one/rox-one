# Workspace-service migrations (unified DDL, W1-05)

Issue #1502 · unified spec **v2** (DATA-MODEL §12). 26 files land here; the 27th
(`40-tables.sql`, 9 tables) is owned by Unified Tables (#1295) and is **reserved,
not authored** in this package.

## File numbering: spec number → 5NN on disk

`applyWorkspaceMigrations` (`src/database/migrations.ts`) sorts by name with a
numeric locale compare and requires the applied history to be an exact prefix of
the sorted list. Deployed databases already have `01-domain-contract.sql`,
`01-local-auth-bootstrap.sql` and `48-license-audit.sql` applied, so a literal
`02-…`…`47-…` name would sort **before** `48-license-audit.sql` and break every
existing database (`MIGRATION_ORDER_CONFLICT`).

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
| `40-tables.sql` | `540-tables.sql` **RESERVED** | owned by #1295 — do not author here |
| `51-workplace.sql` | `551-workplace.sql` | workplace_app, workplace_favorite |
| `52-mail.sql` | `552-mail.sql` | mail_account |

94 new tables here + 9 in `40-tables.sql` = **103** (DATA-MODEL §12 totals).
4 extended tables: `principal`, `project`, `workspace`, `workspace_member`.

## Ordering inside the new set

Every FK / ALTER target exists earlier in sort order, except three documented
deferrals (child sorts before parent, so the constraint is added later):

- `space.chat_id / root_folder_id / wiki_space_id` → added at the end of
  `512-im.sql` (targets: `chat` in 512, `folder` + `wiki_space` in 511).
- `file_object.owner_drive_id → drive` → added in `516-drive-quota.sql`.
- `calendar_member.calendar_id → calendar` → added in `521-calendar.sql`.

Never edit `01-*.sql` / `48-*.sql`; their checksums are locked.

## Extensions

`citext`, `pg_trgm` and `unaccent` are installed once per database into the
shared `public` schema (`502-directory.sql`). References are schema-qualified
(`public.citext`, `public.gin_trgm_ops`) because the migrator locks
`search_path` to the migration schema: a plain `CREATE EXTENSION IF NOT EXISTS`
would install into the first-migrated schema and stay invisible to later ones.

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
- Chat feed: `message_feed (chat_id, seq DESC)`.
- Quick panels / backlinks: `entity_link_to`, `entity_link_from`,
  `comment_by_resource`, `notification_unread`.
- Review: `check_in_subject`, `check_in_pending_ack`, `goal_check_in_due`,
  `approval_request_pending`.

## Rollback

Migrations are **additive only**: new tables, nullable-or-defaulted columns,
new indexes. There is no down migration by design (checksum-bound history has
no downgrade path). The documented rollback is to **disable the feature flags**;
no module binds these tables until its flag ships (all default OFF), so with
flags off the package is inert and the tables stay empty. If DDL itself must be
reverted on a staging copy, restore from the pre-migration snapshot.

## Table ownership (one writer per table, PLAN §1.3)

directory → `502, 513(invitation)` · acl → `503` · drive → `504, 511, 516` ·
commands/bus → `505` · notify → `506` · search → `507` · social → `508` ·
spaces → `509` · docs → `510` · wiki → `511` · messenger → `512` ·
identity → `513` · agents → `513(agent_binding), 514` · automation → `515` ·
tasks → `520` · calendar → `521, 517(calendar_member)` · goals → `522, 524` ·
projects → `523, 526` · kpis → `525` · meetings → `530` · workplace → `551` ·
mail → `552` · collab → `517` · tables → `540` (#1295).

## Tests

`../test/migrations.unified.test.ts` (static inventory/order/FK-target checks run
without a DB; migrate-up runs against `ROX_TEST_PG_URL`, else a temp `initdb`
cluster, else skip). Required runs: (a) empty DB, (b) `01 + 48` then the new
files, (c) re-run no-op, (d) tampered checksum → `MIGRATION_CHANGED`, plus
`EXPLAIN` index-use assertions on the key queries above.

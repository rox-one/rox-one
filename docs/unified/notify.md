# Notify, activity and the Inbox provider (W1-09, #1506)

Wave-1 contracts for everything that tells a member something happened:
activity (the `domain_event` read model), notifications (fan-out, preferences,
email batching) and the Inbox tabs that surface them.

Spec: `docs/specs/2026-10-08-lark-operately-unified/` — DATA-MODEL §9,
TECH-SPEC §3.5, §4.11, §5, §7; UI-SPEC §12, §27.16.

## Layers

| Layer | Module | Responsibility |
|---|---|---|
| Contract | `packages/core/src/notify/*` | kind table, audience rules, ids-only payload projection, activity read model, Review model, batching windows, renderer registry, `notifications.*` bindings |
| Wire format | `packages/shared/src/notify/schemas.ts` | zod twins for command payloads, rows, list/read responses, `user:{id}` push frames |
| Server | `apps/workspace-service/src/modules/notify/*` | fan-out consumer, `notification_pref`, mark-read + push, email batching worker |
| Renderer | `apps/electron/src/renderer/pages/inbox/inbox-model.ts`, `components/review/registry.ts` | Inbox rows per surface, activity renderers by event type |

## The kind table is the single source

`NOTIFICATION_KIND_TABLE` (`packages/core/src/notify/types.ts`) holds the 28
DATA-MODEL §9.2 kinds — 19 v1, 8 v2 and the v2.1 `reminder_due` — with their
trigger, audience sources and default channels. A test reads
`apps/workspace-service/migrations/506-notify.sql` and asserts the table equals
the `notification.kind` CHECK constraint, so the contract and the DDL cannot
drift apart.

Audience rules are table-driven from the same descriptors:
`audienceSourcesFor(kind)` → `resolveAudience(kind, context)`.

* The actor is never notified about their own action.
* `check_in.notify` decides whether subscribers join the reviewer
  (`everyone`) or not (`selected`, `none`).
* `assignment` reads the relation the event changed — assignee, champion or
  reviewer — never a broadcast.
* A muted principal (`notification_pref.enabled = false`, or a chat mute) is
  dropped before any row is written.

## Fan-out (server)

`NotificationFanout` runs as a W1-03 relay sink: committed `domain_event` rows,
post-commit, at-least-once. Per recipient the order is audience → ACL
(`can(recipient, 'read', subject)`) → preferences → row + push.

* Notification ids come from `(event_id, principal, kind)`
  (`deterministicNotificationId`), so a relay retry updates nothing instead of
  notifying twice.
* The payload is projected through `restrictNotificationPayload`: refs,
  revision, a due instant and scalar id fields only. Titles and bodies never
  leave the entity store; renderers resolve them later.
* Delivery: `notification.created` on `user:{id}` through the same realtime
  bus as every other frame.

STORAGE. The repository mirrors `506-notify.sql` column for column
(`notification`, `notification_pref`, `notification_email_batch`). The shipped
implementation is in-memory; the DDL-bound Postgres store is a drop-in that
only has to implement `NotificationStore`.

## Mark-read

Two transports, one implementation (`NotifyService`):

* `notifications.mark_read` / `mark_all_read` / `update_prefs` through the
  command bus (catalogue entries from W1-03, schema + handler bound by the
  notify module while its host is installed);
* `GET /v1/workspaces/{ws}/notifications` and
  `POST /v1/workspaces/{ws}/notifications/read` for the Inbox.

Both are scoped to the authenticated principal, and both push
`notification.read` on `user:{id}` so a second device syncs. The frame is
sequenced in the **workspace's** realtime log (the one the gateway replays),
never in a log keyed by the recipient — the composed-server suite pins that.

## Email batching

Windows are table-driven: the delivery class comes from the kind's channels
(`email_instant` → immediate, `email_digest` → batched, `email_daily` →
daily), the length from `EMAIL_WINDOW_MINUTES`, and a principal's
`notification_pref.batch_minutes` overrides the default for batched kinds.

`NotifyEmailWorker.runOnce(at)` closes the windows that are due. With no
outbound transport configured — the current state — it marks the held rows
`skipped` and the batch `failed (outbound-disabled)`: nothing is silently left
held, and nothing pretends to have been sent. With a transport injected it
sends once per window and marks the rows `sent`.

## Inbox surfaces (renderer)

`inbox-model.ts` keeps `ALL_KINDS` as the pre-W1-09 set and adds four activity
kinds. Each is gated by its module's flag (`INBOX_KIND_FLAGS`):

| Inbox kind | Flag | Owner |
|---|---|---|
| `review` | `goals.checkins.v1` | CHK |
| `mention` | `entities.links.v1` | W1-02 |
| `assignment` | `tasks.shared.v1` | TSK |
| `notification` | `notify.inbox.v1` | W1-09 (default OFF) |

With every flag off, `buildInboxItems` returns exactly what it returned before
this package, and the sidebar, the mobile filter and the Home widget are
unchanged. Activity rows carry the entity ref as their title until the entity
resolver fills in a real one.

The notification *pipeline* has no flag of its own: it only reacts to committed
domain events, and those only exist while `commands.bus.v1` (W1-03) is on.

## Renderers

`apps/electron/src/renderer/components/review/registry.ts` registers activity
renderers **by event type**, with a module-prefix fallback, backed by
`ActivityRendererRegistry` in `@rox/core/notify`. Registering the same event
type twice throws, so the Feed cannot depend on import order.

## Tests

* `packages/core/src/notify/__tests__/` — kind table vs the DDL, audience rules
  per event type, payload restriction, activity read model, batching windows,
  Review model, renderer registry, command bindings.
* `packages/shared/src/notify/__tests__/schemas.test.ts` — the zod boundary.
* `apps/workspace-service/test/notify.test.ts` — a goal update notifies
  champion, reviewer and subscribers in a two-user workspace, never the actor
  or a member without access; mark-read and push; route negatives; batching.
* `apps/workspace-service/test/notify.pg.test.ts` — the same exit criterion on
  the *composed* server (`createWorkspaceServer` + a real command transaction +
  the real relay + a real WebSocket) with the W1-05 DDL applied: the Inbox route
  is reachable only because the root configured notify, and mark-read travels
  back on `user:{id}`. Skips without Postgres (`ROX_TEST_PG_URL` or a temp
  `initdb` cluster).
* `apps/electron/src/renderer/pages/inbox/__tests__/inbox-activity.test.ts` —
  the per-module gating.
* `apps/electron/src/renderer/components/review/__tests__/registry.test.ts` —
  the renderer registry.

## Known gaps

* The renderer does not fetch notifications yet: `useInboxItems` accepts a
  `notifications` option, and the workspace notify client that fills it is
  wave-2 work (the REV package).
* `packages/core/src/notify/review.ts` (the Review query model) is a contract:
  the surface that consumes it ships with M10.
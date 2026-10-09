# Collaboration contracts (W1-14, #1511)

Contracts only — no UI, no flag of its own. Package COL builds the surfaces on
`@rox/core/collab`; the reference handlers live in `@rox/server-core/collab`
and are replaced by COL / TSK-1 / CAL where they say so.

## Presence (§11.1)

| Item | Value |
|---|---|
| Statuses | `online`, `away`, `dnd`, `offline` |
| Heartbeat | `presence.heartbeat {status, device, activeRef?, typingIn?}` every 20 s |
| Key | `presence:{workspaceId}:{principalId}`, TTL 60 s |
| Object presence | `presence.obj:{kind}:{id}` via `presence.join` / `presence.leave`, TTL 60 s |
| Topics | `user:{id}` → `presence.changed`; `entity:{kind}:{id}` → `presence.viewers` |
| Throttle | one `presence.changed` per 5 s per principal (coming online always goes out) |
| Away | 5 min without input (`statusForHeartbeat`) |

Presence is **ephemeral**: the handlers return no `domain_event` (DATA-MODEL
§5.17) and nothing is written to a table. The audience is the caller's chat /
space co-members, resolved by the server (`configureCollabRuntime` /
`apps/workspace-service/src/modules/presence/reference-handlers.ts`).

## Docs (§11.2–§11.4)

- `AwarenessState {user:{id,name,color,avatar}, cursor, selection, following?, viewport?}`;
  the peer colour is `peerColorFor(principalId)` — 8 hues at `oklch(0.62 0.15 h)`,
  stable across restarts. `awarenessCapabilityFor(role)` maps the ACL lattice to
  `edit | suggest | view` and drives `connection.readOnly`.
- Comment anchors are `{start, end}` = base64 of `Y.encodeRelativePosition`,
  plus `quote` (≤ 200 chars) and `blockId`. A collapsed range means the anchored
  text is gone. `packages/core/src/collab/__tests__/anchor.yjs.test.ts` proves
  the property against real yjs replicas and a y-prosemirror document.
- Suggestions: `docs.suggest_changes` opens a row, `docs.sync_suggestions`
  (the debounced Y-doc observer) marks vanished rows `stale` and reopens
  returning ones, `docs.decide_suggestion` decides **once** —
  `canDecideSuggestion` lets an editor decide anything, the author withdraw only,
  and never a commenter.

## Conflicts (§11.6)

`field_revisions` (`{field: revision}`) decides per field: a patch conflicts only
where `field_revisions[f] > expectedRevision`. The rejection is
`CONFLICT {field, theirs, mine, revision}` with `currentRevision`; it travels as
a receipt error with `code: 'CONFLICT'`.

## Receipts and doc views (§11.7)

- `im.mark_read {seq}` raises `chat_member.last_read_seq` monotonically, emits
  `read.changed` at most once per 2 s and refuses a chat the caller is not a
  member of. "Read by" is computed on demand (`readBy`, capped at 500 members).
- A DM emits nothing unless **both** sides share receipts
  (`readChangedVisible` / the service query in
  `apps/workspace-service/src/modules/collab/reference-handlers.ts`).
- `docs.record_view` writes one `doc_view` row per 10 minutes per user and never
  moves `first_viewed_at`.

## Shared calendars (§11.9)

`calendar_member` roles are `owner | editor | viewer | free_busy`; `free_busy`
folds onto the ACL special role of the same name. A free-busy subscriber sees
`{start, end, busy: true}` from the query layer (`calendar.free_busy`) and,
through the `calendar:{id}` topic filter (`redactCalendarFrame`), only
`{startAt, endAt, busy, allDay}` — no title, no attendees. Transparent and
declined events do not block time.
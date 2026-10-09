# Cross-surface commands, TECH-SPEC §12 (W1-14, #1511)

The fourteen commands that create an entity **at** a place in another surface.
Signatures and risk classes live in `@rox/core/xsc`; payload schemas in
`@rox/shared/xsc`; reference handlers in `@rox/server-core/xsc`. The payload
schema and the risk class are bound through `COMMAND_MODULES` **before** the
W1-06 reference module, which then skips those types.

## Shared rules

1. Every `*_from_*` and `insert_*_block` writes
   `entity_link(created → origin, 'derived-from', role:'origin', anchor)` in the
   same transaction. A doc-block origin is the **doc** (a doc block is not an
   entity kind); the block lives in the link anchor as `{blockId}`.
2. The block or card at the origin renders from the ref, never as a copy — a
   task made from a checklist item stores the anchor and no title of its own.
3. The idempotency key is the client `commandId`, and a block command derives
   the ids it creates from `xscDerivationKey(docRef, blockId)`
   (`note:<id>#<blockId>`), so a replay conflicts instead of double-creating.
   The payload therefore carries the client-generated Yjs `blockId`.
4. A private-note origin creates a local entity; "create in workspace" stores
   the cross-authority ref.
5. Natural-language parsing runs client-side and is shown before confirm.

`docs.insert_*_block` and `docs.embed_view` also write the `embeds` link from
the doc to the entity the block renders.

## Risk classes (§12 "risk", §13.2 step 5)

| Command | Risk |
|---|---|
| `docs.insert_task_block` | routine on a private doc, **consequential** on a shared one (also consequential when the nested task is assigned to someone else) |
| `tasks.create_from_selection` | routine, consequential when `assignee ≠ owner` |
| `tasks.create_many_from_checklist` | **privileged** above 20 items, else routine |
| `tasks.create_from_message` | routine, consequential when `assignee ≠ owner` |
| `docs.insert_event_block` | consequential when the draft invites anyone |
| `calendar.create_event` | consequential when `attendees ≠ ∅` |
| `calendar.create_event_from_message` | consequential (attendees always resolve) |
| `docs.insert_meeting_block` | routine |
| `vc.start_meeting` | consequential when `participants ≠ ∅` |
| `docs.embed_view` | routine |
| `docs.create_from_messages` | routine |
| `im.create_chat` | consequential |
| `im.send_message` | routine |
| `agents.invoke` | consequential |

`XSC_DOC_BLOCK_RISK` names both sides of the private/shared doc split; the
registry binds the strict one, because the payload and `CommandRiskContext`
carry no authority discriminator.

## Results that exist only on the wire

`tasks.create_from_message` and `calendar.create_event_from_message` return the
`seq` of the card they post into the origin chat; `vc.start_meeting` returns
`{callRef, joinUrl}`; `agents.invoke` returns `{sessionRef, replyThread}` and
parks a reference approval for the agent's owner (`agent-approval`, decided with
`agents.decide_approval` until the policy engine of #1508 replaces it).

`chatRef` / `docRef` / `calendarRef` may be omitted when the envelope `target`
already names that entity; a payload ref that contradicts the target is
FORBIDDEN.
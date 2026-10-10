# 009 — Meetings calls/rooms honesty: stay fail-closed

Ticket 14. Parent: T10 (meetings proposal read-RPC + inbox). Recorded so no
agent later “fixes” the missing dialer or room join.

**Status:** ACCEPTED — current binding is **blocked, no live calls/rooms**.

**Owner:** product (pzd). An agent must not enable dialing or room joins.

## Context

The «Встречи» screen ships local capture/import/transcription only. Calls and
live rooms were prototyped behind Conation shells and have **no provider**:

- `packages/server-core/src/meetings/conation/calendar-calls.ts`
  - `fakeDialerEnabled()` returns `false`.
  - `bindCall(...)` never dials: it returns `blocked('call-conation-unconfirmed')`
    and, once authorized, `blocked('call-bind-not-live')`.
- `packages/server-core/src/meetings/rooms.ts`
  - `ROOM_PROVIDER_DECISION = { provider: null, license: null, decided: false }`.
  - `joinRoom(...)` always returns `{ ok: false }` (`sfu-undecided` /
    `consent-required`); `roomCapabilityEnabled()` returns `false`.
- `packages/server-core/src/handlers/rpc/meetings.ts` routes `meetings:roomJoin`
  through `gateMeetingConationShell('room', …)`, so the RPC stays gated even if
  the shell changes.
- The renderer has no dialer surface: the Conation panel test asserts it does
  **not** contain `fakeDialer`.

A stub button is not a room, and a fake dialer would be dishonest about a
capability the app does not have.

## Decision

**Calls and rooms stay fail-closed.**

- `fakeDialerEnabled()` stays `false`; no fake dialer is added to any surface.
- `bindCall` / `joinRoom` keep returning blocked/`ok: false`.
- `meetings:roomJoin` stays behind `gateMeetingConationShell('room', …)`.
- The UI must not present a dialer or “join room” control that pretends to work.

## Considered options (not chosen)

- **Ship a fake dialer to demo the flow** — rejected. It advertises a call
  capability that is not wired to any provider.
- **Add a local-only room stub** — rejected. Without an SFU/media provider
  decision there is no real media path; a stub is a fake room.

## What would flip this

A human:

1. Picks an SFU/media provider and records the license in
   `ROOM_PROVIDER_DECISION` (flips `decided` to `true`).
2. Confirms the Conation write capability for `GraphqlSoupCall`.
3. Then a real dialer/room join can be implemented and gated on presence.

Until then the shells remain the honest, blocked current ship.
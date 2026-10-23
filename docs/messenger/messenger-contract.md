# Rox Messenger ↔ Rox Calls: channel/room id contract (v1, 2026-10-14)

Owner: Rox Messenger (self-hosted Apache-2.0 relay, Option A). Consumer: Rox Calls (LiveKit + transcription).

## Identifiers
- **channelId**: lowercase canonical UUIDv4 string (e.g. `3f2b…-…`). Same value as the relay's NIP-29 `h` tag and the DB `channel_id`. Stable forever; renames don't change it.
- **DM / group chat**: also a channel, with `channelType` ∈ `stream | dm | group | forum`. DMs have a channelId like everything else; never derive ids from member lists.
- **orgId**: the rox org id from workspace-service. Each channel belongs to exactly one org.
- **userId**: the rox account id. The relay identity is a per-user Nostr pubkey (hex), mapped by workspace-service (`GET /im/identity/:userId → {pubkey}`). Calls should key users by **userId**.
- **threadId**: event id (64-hex) of the root message.

## LiveKit room naming
- Channel call room: `rox-ch-<channelId>`
- Thread call (optional): `rox-th-<channelId>-<threadId first 16 hex>`
- Calls MUST check membership before minting a LiveKit token: `GET {workspace-service}/im/channels/:channelId/members/:userId` → 200 = allowed (guests included only for their invited channels).

## Events Calls posts into the channel (via workspace-service → relay, signed by service key)
Kind 9 stream message with tag `["rox", "call"]` plus these JSON fields in `content`:
- `{"type":"call.started","roomName","startedBy":userId,"ts"}`
- `{"type":"call.ended","roomName","durationSec","participants":[userId]}`
- `{"type":"call.transcript","roomName","transcriptUrl","summary"}` (stored in MinIO `rox-im-media`)
The messenger renders these as call cards, and they show up in Лента using the same per-channel filter (`feedItem.channelId`).

## Endpoints
- Relay: `wss://chat.rox.one` (NIP-01/42). REST: `https://chat.rox.one/api/...`
- Auth: workspace-service `POST /im/token` → short-lived relay token (rox org membership).

## Stability
Only additive changes in v1. Breaking changes need a v2 file and a message to Rox Calls.

## v1.1 additions (2026-10-14, for PR #2042 feat/team-calls)

### Relay bridge (workspace-service module `im`)
- `POST /v1/im/token` (Bearer = normal workspace actor JWT) → `{ relayUrl, pubkey, authEvent? , expiresAt }`. Checks rox org membership; on first call registers the user's relay pubkey (`im_identity` table: userId ↔ pubkey) and adds it as a relay member (owner-signed membership event). Removing a user from an org removes relay membership.
- `GET /v1/im/channels/:channelId/members/:userId` → `200 {role}` | `404`. Calls uses this before issuing a LiveKit token.

### Service events endpoint
`POST /v1/im/channels/:channelId/service-events`
- Auth: Bearer actor JWT; the actor must be a channel member (guests only in their invited channels).
- Body (JSON, max 16 KB):
  - `{"type":"call.started","roomName":"rox-ch-<channelId>","callId":"<uuid>","ts":<ms>}`
  - `{"type":"call.ended","roomName","callId","durationSec","participants":[userId]}`
  - `{"type":"call.transcript","roomName","callId","transcriptUrl","summary"}` (transcriptUrl must point at chat.rox.one/media or the org drive)
- Idempotency: `(callId,type)` is unique, so a repeat returns `200` with the same `eventId`.
- Effect: workspace-service signs a kind-9 stream message (tags `["h",channelId]`, `["rox","call"]`, `["rox-call-id",callId]`) with the service key and publishes it to the relay. Every device syncs it through chat-core, the messenger renders a call card, and the Лента fan-out writes a feed item `{source:"messenger", channelId, kind:"call.*"}` (per-channel filter applies).
- Response `201 {eventId}`; errors `400 INVALID`, `403 FORBIDDEN`, `404 NOT_FOUND`, `502 RELAY_UNAVAILABLE`.

### Presence (real, from the relay)
- In the desktop, `chat-core` subscribes to relay ephemeral kind 20001 (presence) and 20002 (typing). The renderer gets `im:presence` IPC events `{userId, status: "online"|"away"|"offline", lastSeenAt}`.
- Server side: `GET /v1/im/presence?userIds=a,b` → `[{userId,status,lastSeenAt}]`, served from the relay's Redis presence through workspace-service. Calls should use this rather than its own heartbeat.

/**
 * Rox Messenger ↔ relay (NIP-01) kind and tag vocabulary (v1).
 *
 * The single source of truth for the numeric kinds and tag names the relay
 * bridge signs. See `docs/messenger/messenger-contract.md` §v1.1.
 */

/** NIP-29 stream message: one chat/call card inside a channel. */
export const NOSTR_KIND_STREAM_MESSAGE = 9
/** Relay-admin: add a pubkey to the relay (NIP-43 style). */
export const NOSTR_KIND_RELAY_ADMIN_ADD_MEMBER = 9030
/** Relay-admin: remove a pubkey from the relay. */
export const NOSTR_KIND_RELAY_ADMIN_REMOVE_MEMBER = 9031
/** NIP-98 HTTP auth event. */
export const NOSTR_KIND_NIP98_AUTH = 27235
/** Ephemeral presence (NIP-38 style) — relay replaces, never stores. */
export const NOSTR_KIND_PRESENCE = 20001
/** Ephemeral typing indicator. */
export const NOSTR_KIND_TYPING = 20002

/** Channel tag (`["h", channelId]`) — NIP-29 group id. */
export const IM_CHANNEL_TAG = 'h'
/** Marks a stream message as a rox call card (`["rox", "call"]`). */
export const IM_SERVICE_TAG = 'rox'
export const IM_SERVICE_TAG_VALUE = 'call'
/** Idempotency key of a call (`["rox-call-id", callId]`). */
export const IM_CALL_ID_TAG = 'rox-call-id'
/** Member tag on a relay-admin event (`["p", pubkey]`). */
export const IM_MEMBER_TAG = 'p'
/** Optional role tag on a relay-admin event (`["role", "member"]`). */
export const IM_ROLE_TAG = 'role'

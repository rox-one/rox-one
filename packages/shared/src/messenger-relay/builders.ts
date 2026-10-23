/**
 * Event builders for the relay bridge: call service messages, relay-admin
 * membership events and NIP-98 HTTP auth events. Every builder returns a
 * fully signed {@link NostrEvent} whose `pubkey` is derived from `secretKey`.
 */

import {
  IM_CALL_ID_TAG,
  IM_CHANNEL_TAG,
  IM_MEMBER_TAG,
  IM_ROLE_TAG,
  IM_SERVICE_TAG,
  IM_SERVICE_TAG_VALUE,
  NOSTR_KIND_NIP98_AUTH,
  NOSTR_KIND_RELAY_ADMIN_ADD_MEMBER,
  NOSTR_KIND_RELAY_ADMIN_REMOVE_MEMBER,
  NOSTR_KIND_STREAM_MESSAGE,
} from './kinds.ts'
import { sha256Hex, schnorrPublicKey, signEvent, type NostrEvent } from './nip01.ts'

function unixSeconds(createdAt: number | undefined): number {
  return createdAt ?? Math.floor(Date.now() / 1000)
}

export interface CallServiceEventInput {
  /** 32-byte service secret key (hex). Never logged. */
  readonly secretKey: string
  readonly channelId: string
  readonly callId: string
  /** Already-shaped call payload (see `docs/messenger/messenger-contract.md`). */
  readonly content: Record<string, unknown>
  readonly createdAt?: number
}

/**
 * Kind-9 stream message carrying a call card.
 * Tags: `["h", channelId]`, `["rox", "call"]`, `["rox-call-id", callId]`.
 * Content: `JSON.stringify(content)`.
 */
export function buildCallServiceEvent(input: CallServiceEventInput): NostrEvent {
  return signEvent({
    pubkey: schnorrPublicKey(input.secretKey),
    created_at: unixSeconds(input.createdAt),
    kind: NOSTR_KIND_STREAM_MESSAGE,
    tags: [
      [IM_CHANNEL_TAG, input.channelId],
      [IM_SERVICE_TAG, IM_SERVICE_TAG_VALUE],
      [IM_CALL_ID_TAG, input.callId],
    ],
    content: JSON.stringify(input.content),
  }, input.secretKey)
}

export type RelayAdminAction = 'add' | 'remove'

export interface RelayAdminEventInput {
  readonly secretKey: string
  readonly action: RelayAdminAction
  /** The member's x-only pubkey (hex). */
  readonly pubkey: string
  readonly role?: string
  readonly createdAt?: number
}

/**
 * Relay-admin membership event: kind 9030 (`add`) / 9031 (`remove`), tag
 * `["p", pubkey]` and, for `add`, an optional `["role", role]`.
 */
export function buildRelayAdminEvent(input: RelayAdminEventInput): NostrEvent {
  const tags: string[][] = [[IM_MEMBER_TAG, input.pubkey]]
  if (input.action === 'add' && input.role) tags.push([IM_ROLE_TAG, input.role])
  return signEvent({
    pubkey: schnorrPublicKey(input.secretKey),
    created_at: unixSeconds(input.createdAt),
    kind: input.action === 'add' ? NOSTR_KIND_RELAY_ADMIN_ADD_MEMBER : NOSTR_KIND_RELAY_ADMIN_REMOVE_MEMBER,
    tags,
    content: '',
  }, input.secretKey)
}

export interface Nip98AuthEventInput {
  readonly secretKey: string
  /** Absolute request URL (`["u", url]`). */
  readonly url: string
  /** HTTP method, upper-case (`["method", method]`). */
  readonly method: string
  /** Exact request body; hashed into the `["payload", …]` tag. */
  readonly payload: string
  readonly createdAt?: number
}

/**
 * NIP-98 HTTP auth event (kind 27235). Tags: `["u", url]`, `["method", …]`,
 * `["payload", sha256hex(body)]`.
 */
export function buildNip98AuthEvent(input: Nip98AuthEventInput): NostrEvent {
  return signEvent({
    pubkey: schnorrPublicKey(input.secretKey),
    created_at: unixSeconds(input.createdAt),
    kind: NOSTR_KIND_NIP98_AUTH,
    tags: [
      ['u', input.url],
      ['method', input.method.toUpperCase()],
      ['payload', sha256Hex(input.payload)],
    ],
    content: '',
  }, input.secretKey)
}

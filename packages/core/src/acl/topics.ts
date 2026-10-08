/**
 * W1-04 (#1501) — Realtime topic authorization (TECH-SPEC §3.5).
 *
 * The W1-03 (#1500) gateway authorizes every `subscribe` frame through an
 * injected authorizer. `createAclTopicAuthorizer(acl)` parses the topic into
 * an entity ref and requires `acl.can(principal, 'view', ref)`:
 *
 *   user:{id}              → only the principal itself, and only while it is
 *                            active with an active workspace membership
 *   entity:{kind}:{id}     → { kind, id } (kind aliases normalised)
 *   space:{id} / channel:{id} / doc:{id} / task-list:{id} / calendar:{id} /
 *   meeting:{id} / …       → the aliased kind (doc → note, meeting → call)
 *
 * Unknown or malformed topics are denied (fail closed).
 */

import { normalizeKindAlias } from '../entities/aliases.ts'
import { isEntityKind } from '../entities/kinds.ts'
import type { EntityRef } from '../entities/refs.ts'
import type { Acl, AclPrincipal } from './evaluate.ts'

export type ParsedTopic =
  | { type: 'user'; principalId: string }
  | { type: 'entity'; ref: EntityRef }

const ID = /^[^\s:]{1,256}$/

/** Parse a realtime topic; `null` when it is not an authorizable topic. */
export function parseTopicRef(topic: string): ParsedTopic | null {
  if (typeof topic !== 'string' || topic.length === 0 || topic.length > 512) return null
  const first = topic.indexOf(':')
  if (first <= 0) return null
  const prefix = topic.slice(0, first)
  const rest = topic.slice(first + 1)
  if (prefix === 'user') return ID.test(rest) ? { type: 'user', principalId: rest } : null
  if (prefix === 'entity') {
    const second = rest.indexOf(':')
    if (second <= 0) return null
    const kind = normalizeKindAlias(rest.slice(0, second))
    const id = rest.slice(second + 1)
    if (!isEntityKind(kind) || !ID.test(id)) return null
    return { type: 'entity', ref: { kind, id } }
  }
  const kind = normalizeKindAlias(prefix)
  if (!isEntityKind(kind) || !ID.test(rest)) return null
  return { type: 'entity', ref: { kind, id: rest } }
}

export type TopicAuthorizer = (principal: AclPrincipal, topic: string) => Promise<boolean>

/** Build the gateway authorizer: every subscribe calls `acl.can(…, 'view', ref)`. */
export function createAclTopicAuthorizer(acl: Acl): TopicAuthorizer {
  return async (principal, topic) => {
    const parsed = parseTopicRef(topic)
    if (!parsed) return false
    if (parsed.type === 'user') return parsed.principalId === principal.id && await acl.isActiveMember(principal)
    return acl.can(principal, 'view', parsed.ref)
  }
}

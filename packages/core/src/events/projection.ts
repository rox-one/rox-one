/**
 * W1-03 (#1500) — Domain event → realtime publications.
 *
 * Each realtime event is the projection of exactly one `domain_event` row
 * (TECH-SPEC §5). Projections are pure functions of the stored event, so the
 * post-commit publisher (and a catch-up relay after a crash) can always
 * re-derive what to push. Owner modules register projectors for their event
 * types; without one, an event with a subject projects to the generic
 * `entity:{kind}:{id}` → `entity.updated` (ids only: payloads never carry
 * content, so per-subscriber ACL filtering stays the only gate).
 */

import type { DomainEvent } from './types.ts'
import { formatTopic, isRealtimeEventType, parseTopic, userTopic, entityTopic, type Topic } from './topics.ts'

export interface RealtimePublication {
  topic: Topic
  /** Realtime event type (TECH-SPEC §5) for the topic kind. */
  type: string
  payload?: unknown
}

export type EventProjector = (event: DomainEvent) => RealtimePublication[]

/** Generic projection: the subject's entity topic with an ids-only payload. */
export function defaultEventProjection(event: DomainEvent): RealtimePublication[] {
  if (!event.subject) return []
  return [{
    topic: entityTopic(event.subject),
    type: 'entity.updated',
    payload: { ref: { kind: event.subject.kind, id: event.subject.id }, revision: event.aggregateRevision, domainType: event.type },
  }]
}

/** `system.pinged` → `user:{actor}` (W1-03 exit criterion). */
export const systemPingedProjection: EventProjector = (event) => {
  if (!event.actorId) return []
  const payload = (event.payload ?? {}) as { nonce?: unknown }
  return [{
    topic: userTopic(event.actorId),
    type: 'system.pinged',
    payload: { commandId: event.causationId ?? null, nonce: typeof payload.nonce === 'string' ? payload.nonce : null },
  }]
}

export class EventProjectionRegistry {
  private readonly projectors = new Map<string, EventProjector[]>()

  constructor(options: { builtIns?: boolean } = {}) {
    if (options.builtIns !== false) this.register('system.pinged', systemPingedProjection)
  }

  register(domainType: string, projector: EventProjector): void {
    const list = this.projectors.get(domainType) ?? []
    list.push(projector)
    this.projectors.set(domainType, list)
  }

  /** Valid publications only: unknown topics or types for the topic kind are dropped. */
  project(event: DomainEvent): RealtimePublication[] {
    const projectors = this.projectors.get(event.type)
    const raw = projectors ? projectors.flatMap(projector => projector(event)) : defaultEventProjection(event)
    const out: RealtimePublication[] = []
    for (const publication of raw) {
      const parsed = parseTopic(publication.topic)
      if (!parsed || !isRealtimeEventType(parsed.kind, publication.type)) continue
      out.push({ ...publication, topic: formatTopic(parsed) })
    }
    return out
  }
}

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

/** A registered projector threw for `event` (tagged so hosts don't log it as a listener failure). */
export class ProjectorError extends Error {
  readonly eventId: string
  readonly domainType: string
  constructor(event: Pick<DomainEvent, 'eventId' | 'type'>, readonly reason: unknown) {
    super(`Projector failed for ${event.type} (${event.eventId}): ${reason instanceof Error ? reason.message : String(reason)}`)
    this.name = 'ProjectorError'
    this.eventId = event.eventId
    this.domainType = event.type
  }
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

  /**
   * Valid publications only: unknown topics or types for the topic kind are
   * dropped. Each projector is isolated: one that throws is reported through
   * `onError` (`ProjectorError`) without discarding the others' publications,
   * and the ids-only `defaultEventProjection` is added so subscribers of the
   * subject still learn that something changed and refetch. Without `onError`
   * a projector error propagates (callers decide).
   */
  project(event: DomainEvent, onError?: (error: ProjectorError) => void): RealtimePublication[] {
    const projectors = this.projectors.get(event.type)
    let raw: RealtimePublication[]
    if (!projectors) raw = defaultEventProjection(event)
    else {
      raw = []
      let failed = false
      for (const projector of projectors) {
        try {
          raw.push(...projector(event))
        } catch (error) {
          const tagged = new ProjectorError(event, error)
          if (!onError) throw tagged
          failed = true
          onError(tagged)
        }
      }
      if (failed) {
        for (const fallback of defaultEventProjection(event)) {
          if (!raw.some(p => p.topic === fallback.topic && p.type === fallback.type)) raw.push(fallback)
        }
      }
    }
    const out: RealtimePublication[] = []
    for (const publication of raw) {
      const parsed = parseTopic(publication.topic)
      if (!parsed || !isRealtimeEventType(parsed.kind, publication.type)) continue
      out.push({ ...publication, topic: formatTopic(parsed) })
    }
    return out
  }
}

import type { Lesson, LessonScope } from '@rox/shared/memory/types'
import type { NativeDataReceipt, NoteDocument } from '@rox/shared/protocol/dto'
import type { PageRenderLease } from '@rox/shared/pages/types'
import type { CapabilitySnapshot, SignalName, TourCapability, TourSignal } from '../../contracts'
import type { TourObservation } from '../../runtime/hooks'

/** Native objects stay in memory. Only the frozen, content-free TourSignal leaves the adapter. */
export type KnowledgeCompletion =
  | { kind: 'note-created'; workspaceId: string; note: NoteDocument; readback: NoteDocument | null }
  | { kind: 'note-saved'; workspaceId: string; note: NoteDocument; receipt: NativeDataReceipt | null; operationId: string; expectedRevision: number | null }
  | { kind: 'memory-saved'; workspaceId: string; scope: LessonScope; lesson: Lesson; readback: readonly Lesson[] }
  | { kind: 'page-host-rendered'; workspaceId: string; pageSlug: string; contentDigest: string; lease: PageRenderLease }
  | { kind: 'search-finished' | 'search-result-opened'; workspaceId: string; current: boolean; succeeded: boolean }

export function matchesNoteReceipt(receipt: NativeDataReceipt | null, operation: { workspaceId: string; nativeId: string; operationId: string; expectedRevision: number | null }): boolean {
  return !!receipt && receipt.workspaceId === operation.workspaceId && receipt.kind === 'notes'
    && receipt.nativeId === operation.nativeId && receipt.operationId === operation.operationId && !receipt.deleted
    && Number.isSafeInteger(receipt.revision) && receipt.revision === (operation.expectedRevision ?? 0) + 1
    && Number.isSafeInteger(receipt.sequence) && receipt.sequence > 0 && !!receipt.issuer && !!receipt.subject && !!receipt.contentHash
}

export function matchesMemoryReadback(lesson: Lesson, readback: readonly Lesson[], scope: LessonScope): boolean {
  return lesson.scope === scope && readback.some(item => item.scope === scope && item.rule === lesson.rule
    && item.ts === lesson.ts && item.category === lesson.category && !!item.negative === !!lesson.negative
    && item.owner?.issuer === lesson.owner?.issuer && item.owner?.subject === lesson.owner?.subject)
}

export function pageLeaseMatches(lease: PageRenderLease, pageSlug: string, contentDigest: string | undefined, now = Date.now()): boolean {
  return !!contentDigest && !!lease.leaseId && lease.pageSlug === pageSlug && lease.contentDigest === contentDigest
    && Number.isFinite(lease.expiresAt) && lease.expiresAt > now
}

export function deriveKnowledgeSignals(observation: TourObservation | null, completion: KnowledgeCompletion, now = Date.now()): TourSignal[] {
  if (!observation || observation.binding.workspaceId !== completion.workspaceId) return []
  let name: SignalName
  let level: TourSignal['level'] = 'verified'
  let origin: TourSignal['origin'] = 'native-commit'
  let eventToken = observation.operationToken
  switch (completion.kind) {
    case 'note-created': {
      const { note, readback } = completion
      if (!readback || !note.id || readback.id !== note.id || readback.content !== note.content
        || readback.nativeId !== note.nativeId || readback.nativeRevision !== note.nativeRevision
        || readback.revision !== note.revision) return []
      name = 'note.created'
      break
    }
    case 'note-saved':
      if (!matchesNoteReceipt(completion.receipt, { ...completion, nativeId: completion.note.nativeId ?? completion.note.id })) return []
      name = 'note.persisted'; eventToken = completion.operationId
      break
    case 'memory-saved':
      if (!matchesMemoryReadback(completion.lesson, completion.readback, completion.scope)) return []
      name = 'memory.persisted'
      break
    case 'page-host-rendered':
      if (!pageLeaseMatches(completion.lease, completion.pageSlug, completion.contentDigest, now)) return []
      if (observation.binding.entityId && observation.binding.entityId !== completion.pageSlug) return []
      name = 'page.rendered'; level = 'observed'; origin = 'ui-observation'
      eventToken = `${observation.operationToken}:${completion.lease.leaseId}`
      break
    case 'search-finished':
    case 'search-result-opened':
      if (!completion.current || !completion.succeeded) return []
      name = completion.kind === 'search-finished' ? 'search.finished' : 'search.result-opened'
      level = completion.kind === 'search-finished' ? 'observed' : 'verified'
      origin = 'native-event'
      break
  }
  return [{ name, binding: observation.binding, operationToken: observation.operationToken, operationStartedAt: observation.at,
    eventToken, at: now, level, origin } as TourSignal]
}

type Readiness = TourCapability['state']
export interface KnowledgeReadiness {
  notes: Readiness; memory: Readiness; memoryWrite: Readiness; pages: Readiness; pagePresent: boolean; search: Readiness
}
function capability(state: Readiness): TourCapability {
  return state === 'ready' ? { state } : { state, reason: state === 'denied' ? 'not-authorized' : state === 'pending' ? 'installing' : 'api-unavailable' }
}
export function knowledgeCapabilities(state: KnowledgeReadiness): CapabilitySnapshot {
  return { 'notes.available': capability(state.notes), 'memory.available': capability(state.memory),
    'memory.write-available': capability(state.memoryWrite), 'pages.available': capability(state.pages),
    'pages.entity-present': state.pagePresent ? { state: 'ready' } : { state: 'pending', reason: 'missing-entity' }, 'search.available': capability(state.search) }
}

export const knowledgeTargetBindings = [
  'notes.create', 'notes.editor', 'memory.list', 'memory.scope', 'memory.editor', 'pages.host', 'pages.freshness', 'search.input', 'search.results',
] as const

export interface SearchTicket { readonly workspaceId: string; readonly query: string; readonly generation: number }
/** Every request has a generation, including equal queries after a workspace round trip. */
export function createSearchFence() {
  let generation = 0
  let latest: SearchTicket | null = null
  return {
    begin(workspaceId: string, query: string): SearchTicket { latest = { workspaceId, query: query.trim(), generation: ++generation }; return latest },
    current(ticket: SearchTicket): boolean { return latest?.generation === ticket.generation && latest.workspaceId === ticket.workspaceId && latest.query === ticket.query },
    invalidate(): void { ++generation; latest = null },
  }
}

/** A result must survive native freshness read-back before the existing route can open it. */
export async function openCurrentSearchResult<T>(options: {
  read: () => Promise<readonly T[] | null>
  current: () => boolean
  matches: (item: T) => boolean
  open: (item: T) => void | Promise<void>
}): Promise<boolean> {
  try {
    const items = await options.read()
    if (!options.current()) return false
    const hit = items?.find(options.matches)
    if (!hit) return false
    await options.open(hit)
    return true
  } catch { return false }
}

export function notesReadCapability(notesError: { code: string } | null, _assetsError: { code: string } | null): TourCapability {
  return notesError ? { state: notesError.code === 'AUTH_FAILED' ? 'denied' : 'unavailable', reason: notesError.code === 'AUTH_FAILED' ? 'not-authorized' : 'api-unavailable' } : { state: 'ready' }
}

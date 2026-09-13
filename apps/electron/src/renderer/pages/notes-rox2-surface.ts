/**
 * ROX2-028: native Notes vault surface.
 * SiYuan knowledge host may exist separately. Conation Notes is not this surface.
 */
import {
  fixtureResult,
  formatRox2EntityId,
  queuedResult,
  type Rox2Entity,
  type Rox2Result,
} from '@craft-agent/core/rox2'

export const NOTES_SURFACE_ID = 'notes' as const

/** Native Notes are reachable without Conation flags. */
export const NOTES_REQUIRES_CONATION_FLAG = false as const

export function bindNativeNote(input: {
  id: string
  title: string
  workspaceId: string
  updatedAt: number
}): Rox2Entity {
  if (!input.id) throw new Error('note id is empty')
  return {
    id: formatRox2EntityId('note', input.id),
    kind: 'note',
    displayName: input.title || input.id,
    workspaceId: input.workspaceId,
    source: 'native',
    permissions: ['read', 'write'],
    updatedAt: input.updatedAt,
  }
}

export function nativeNoteListResult(notes: readonly Rox2Entity[]): Rox2Result {
  return {
    ok: true,
    state: 'live',
    entityId: notes[0]?.id ?? formatRox2EntityId('note', 'empty-list'),
  }
}

export function noteSurfaceResult(source: 'native' | 'fixture' | 'conation'): Rox2Result {
  if (source === 'fixture') {
    return fixtureResult('notes.fixture', 'Playground notes are fixture, not a live vault')
  }
  if (source === 'conation') {
    return queuedResult('notes.conation', 'Conation Notes is read-only and is not the native vault')
  }
  return { ok: true, state: 'live', entityId: formatRox2EntityId('note', 'surface') }
}

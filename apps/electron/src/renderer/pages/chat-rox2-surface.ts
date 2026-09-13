/**
 * ROX2-021: native sessions collection + chat.
 * Binds chat sessions to Rox2 entities/results. Conation is not this surface.
 */
import {
  fixtureResult,
  formatRox2EntityId,
  queuedResult,
  type Rox2Entity,
  type Rox2Result,
} from '@craft-agent/core/rox2'

export const SESSIONS_SURFACE_ID = 'sessions' as const

/** Sessions rail is native and is not gated on Conation flags. */
export const SESSIONS_REQUIRES_CONATION_FLAG = false as const

export function bindNativeSession(input: {
  id: string
  title: string
  workspaceId: string
  updatedAt: number
}): Rox2Entity {
  if (!input.id) throw new Error('session id is empty')
  return {
    id: formatRox2EntityId('session', input.id),
    kind: 'session',
    displayName: input.title || input.id,
    workspaceId: input.workspaceId,
    source: 'native',
    permissions: ['read', 'write'],
    updatedAt: input.updatedAt,
  }
}

/** Empty native lists are live. Playground/mocked rows are fixture. */
export function nativeSessionListResult(sessions: readonly Rox2Entity[]): Rox2Result {
  return {
    ok: true,
    state: 'live',
    entityId: sessions[0]?.id ?? formatRox2EntityId('session', 'empty-list'),
  }
}

export function sessionSurfaceResult(source: 'native' | 'fixture' | 'conation'): Rox2Result {
  if (source === 'fixture') {
    return fixtureResult('sessions.fixture', 'Playground session rows are fixture, not live')
  }
  if (source === 'conation') {
    return queuedResult('sessions.conation', 'Conation chat is not the native sessions surface')
  }
  return { ok: true, state: 'live', entityId: formatRox2EntityId('session', 'surface') }
}

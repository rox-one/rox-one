import { describe, expect, it } from 'bun:test'
import type { SessionEvent } from '@craft-agent/shared/protocol'
import {
  applyShareGranted,
  applyShareRevoked,
  mapShareApiError,
  ownerCapabilityHeaders,
  revokeShare,
  shareToViewer,
  stripSharedOwnerKey,
  updateShare,
  type ShareCapabilityHost,
  type ShareSessionRecord,
} from './share-capability.ts'

const OWNER_KEY = 'test-owner-key-32-bytes-aaaaaaaaaaaaaaaa'
const VIEWER = 'https://agents.rox.one'

function silentLog() {
  return { info() {}, warn() {}, error() {} }
}

function makeSession(extra?: Partial<ShareSessionRecord>): ShareSessionRecord {
  return {
    workspace: { id: 'ws_test', rootPath: '/tmp/ws' },
    ...extra,
  }
}

function makeHost(session: ShareSessionRecord | undefined) {
  const events: Array<{ event: SessionEvent; workspaceId: string }> = []
  const metadataPatches: Array<{ rootPath: string; sessionId: string; patch: Record<string, unknown> }> = []
  const host: ShareCapabilityHost = {
    getSession: (id) => (session && id === 's1' ? session : undefined),
    sendEvent: (event, workspaceId) => { events.push({ event, workspaceId }) },
    log: silentLog(),
  }
  return { host, events, metadataPatches }
}

describe('stripSharedOwnerKey', () => {
  it('removes sharedOwnerKey from renderer-bound fields without dropping share ids', () => {
    const picked = {
      id: 's1',
      sharedId: 'shareid123',
      sharedUrl: `${VIEWER}/s/shareid123`,
      sharedOwnerKey: OWNER_KEY,
    }

    const stripped = stripSharedOwnerKey(picked)

    expect(stripped.sharedId).toBe('shareid123')
    expect(stripped.sharedUrl).toBe(`${VIEWER}/s/shareid123`)
    expect(stripped.sharedOwnerKey).toBeUndefined()
    expect(JSON.stringify(stripped)).not.toContain(OWNER_KEY)
  })

  it('is a no-op when the owner key was never present', () => {
    const picked = { id: 's1', sharedId: 'shareid123' }
    expect(stripSharedOwnerKey(picked)).toEqual(picked)
  })
})

describe('ownerCapabilityHeaders', () => {
  it('sends the owner key as a Bearer token', () => {
    expect(ownerCapabilityHeaders(OWNER_KEY)).toEqual({ Authorization: `Bearer ${OWNER_KEY}` })
  })

  it('omits Authorization when no owner key is persisted', () => {
    expect(ownerCapabilityHeaders(undefined)).toEqual({})
    expect(ownerCapabilityHeaders('')).toEqual({})
  })
})

describe('applyShareGranted / applyShareRevoked', () => {
  it('persists share ids and the owner key on the session record', () => {
    const session = makeSession()
    applyShareGranted(session, { url: `${VIEWER}/s/shareid123`, id: 'shareid123', ownerKey: OWNER_KEY })
    expect(session.sharedUrl).toBe(`${VIEWER}/s/shareid123`)
    expect(session.sharedId).toBe('shareid123')
    expect(session.sharedOwnerKey).toBe(OWNER_KEY)
  })

  it('clears share ids and the owner key', () => {
    const session = makeSession({
      sharedUrl: `${VIEWER}/s/shareid123`,
      sharedId: 'shareid123',
      sharedOwnerKey: OWNER_KEY,
    })
    applyShareRevoked(session)
    expect(session.sharedUrl).toBeUndefined()
    expect(session.sharedId).toBeUndefined()
    expect(session.sharedOwnerKey).toBeUndefined()
  })
})

describe('mapShareApiError', () => {
  it('surfaces LEGACY_SHARE_IMMUTABLE as a typed error', async () => {
    const result = await mapShareApiError(
      new Response(
        JSON.stringify({ error: 'legacy share is immutable', code: 'LEGACY_SHARE_IMMUTABLE' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
      'Failed to update shared session',
    )
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('LEGACY_SHARE_IMMUTABLE')
    expect(result.error).toBeTruthy()
  })

  it('surfaces missing owner capability as SHARE_OWNER_KEY_REQUIRED', async () => {
    const result = await mapShareApiError(
      new Response(
        JSON.stringify({ error: 'owner key required', code: 'SHARE_OWNER_KEY_REQUIRED' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
      'Failed to update shared session',
    )
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('SHARE_OWNER_KEY_REQUIRED')
  })
})

describe('shareToViewer / updateShare / revokeShare', () => {
  it('shareToViewer persists the returned ownerKey via metadata patch', async () => {
    const session = makeSession()
    const { host, events, metadataPatches } = makeHost(session)
    const result = await shareToViewer(host, 's1', {
      getViewerUrl: async () => VIEWER,
      loadStoredSession: () => ({ id: 's1' }),
      updateSessionMetadata: async (rootPath, sessionId, patch) => {
        metadataPatches.push({ rootPath, sessionId, patch })
      },
      fetch: async () => new Response(
        JSON.stringify({ id: 'shareid123', url: `${VIEWER}/s/shareid123`, ownerKey: OWNER_KEY }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    })

    expect(result.success).toBe(true)
    expect(session.sharedOwnerKey).toBe(OWNER_KEY)
    expect(metadataPatches[0]?.patch.sharedOwnerKey).toBe(OWNER_KEY)
    expect(events.some((e) => e.event.type === 'session_shared')).toBe(true)
  })

  it('updateShare sends the ownerKey as a Bearer token', async () => {
    const session = makeSession({
      sharedId: 'shareid123',
      sharedUrl: `${VIEWER}/s/shareid123`,
      sharedOwnerKey: OWNER_KEY,
    })
    const { host } = makeHost(session)
    const seen: { auth: string | null } = { auth: null }
    const result = await updateShare(host, 's1', {
      getViewerUrl: async () => VIEWER,
      loadStoredSession: () => ({ id: 's1' }),
      updateSessionMetadata: async () => {},
      fetch: async (_url, init) => {
        seen.auth = new Headers(init?.headers).get('Authorization')
        return new Response(JSON.stringify({ id: 'shareid123' }), { status: 200 })
      },
    })

    expect(result.success).toBe(true)
    expect(seen.auth).toBe(`Bearer ${OWNER_KEY}`)
  })

  it('revokeShare sends the ownerKey and clears it from the session record', async () => {
    const session = makeSession({
      sharedId: 'shareid123',
      sharedUrl: `${VIEWER}/s/shareid123`,
      sharedOwnerKey: OWNER_KEY,
    })
    const { host, metadataPatches } = makeHost(session)
    const seen: { auth: string | null } = { auth: null }
    const result = await revokeShare(host, 's1', {
      getViewerUrl: async () => VIEWER,
      loadStoredSession: () => ({ id: 's1' }),
      updateSessionMetadata: async (rootPath, sessionId, patch) => {
        metadataPatches.push({ rootPath, sessionId, patch })
      },
      fetch: async (_url, init) => {
        seen.auth = new Headers(init?.headers).get('Authorization')
        return new Response(null, { status: 204 })
      },
    })

    expect(result.success).toBe(true)
    expect(seen.auth).toBe(`Bearer ${OWNER_KEY}`)
    expect(session.sharedOwnerKey).toBeUndefined()
    expect(metadataPatches[0]?.patch.sharedOwnerKey).toBeUndefined()
    expect('sharedOwnerKey' in (metadataPatches[0]?.patch ?? {})).toBe(true)
  })

  it('returns Session not found without touching async-operation state', async () => {
    const { host, events } = makeHost(undefined)
    const result = await shareToViewer(host, 'missing')
    expect(result).toEqual({ success: false, error: 'Session not found' })
    expect(events).toHaveLength(0)
  })
})

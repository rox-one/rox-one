/**
 * SessionManager "Share Online" flow: owner-capability key handling.
 *
 * The desktop client must persist the ownerKey returned by POST /s/api and
 * present it as a Bearer token on update/revoke, while never leaking it into
 * renderer-facing Session DTOs (managedToSession).
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSessionJsonl, writeSessionJsonl, type StoredSession } from '@craft-agent/shared/sessions'
import { SessionManager, createManagedSession, managedToSession } from './SessionManager.ts'

const OWNER_KEY = 'test-owner-key-32-bytes-aaaaaaaaaaaaaaaa'

function writeShareableSession(root: string, sessionId: string, extra?: Partial<StoredSession>) {
  const sessionDir = join(root, 'sessions', sessionId)
  mkdirSync(sessionDir, { recursive: true })
  const stored: StoredSession = {
    id: sessionId,
    workspaceRootPath: root,
    createdAt: 100,
    lastUsedAt: 200,
    messages: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
    ...extra,
  }
  writeSessionJsonl(join(sessionDir, 'session.jsonl'), stored)
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = handler as unknown as typeof fetch
}

describe('SessionManager share owner capability', () => {
  const workspace = { id: 'ws_test', name: 'Test', rootPath: '' }
  let root = ''
  let sm: SessionManager
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'share-flow-'))
    workspace.rootPath = root
    sm = new SessionManager()
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    rmSync(root, { recursive: true, force: true })
  })

  function registerSession(sessionId: string, fields?: Record<string, unknown>) {
    const managed = createManagedSession({ id: sessionId, ...fields }, workspace as never)
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(sessionId, managed)
    return managed as ReturnType<typeof createManagedSession>
  }

  it('shareToViewer persists the returned ownerKey to memory and disk', async () => {
    writeShareableSession(root, 's1')
    const managed = registerSession('s1')
    stubFetch(() => new Response(
      JSON.stringify({ id: 'shareid123', url: 'https://agents.rox.one/s/shareid123', ownerKey: OWNER_KEY }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    ))

    const result = await sm.shareToViewer('s1')

    expect(result.success).toBe(true)
    expect(managed.sharedId).toBe('shareid123')
    expect(managed.sharedOwnerKey).toBe(OWNER_KEY)
    const onDisk = readSessionJsonl(join(root, 'sessions', 's1', 'session.jsonl'))
    expect(onDisk?.sharedOwnerKey).toBe(OWNER_KEY)
  })

  it('updateShare sends the ownerKey as a Bearer token', async () => {
    writeShareableSession(root, 's1')
    registerSession('s1', { sharedId: 'shareid123', sharedUrl: 'https://agents.rox.one/s/shareid123', sharedOwnerKey: OWNER_KEY })
    const seen: { auth: string | null } = { auth: null }
    stubFetch((_url, init) => {
      seen.auth = new Headers(init?.headers).get('Authorization')
      return new Response(JSON.stringify({ id: 'shareid123' }), { status: 200 })
    })

    const result = await sm.updateShare('s1')

    expect(result.success).toBe(true)
    expect(seen.auth).toBe(`Bearer ${OWNER_KEY}`)
  })

  it('revokeShare sends the ownerKey and clears it from memory and disk', async () => {
    writeShareableSession(root, 's1', { sharedId: 'shareid123', sharedOwnerKey: OWNER_KEY })
    const managed = registerSession('s1', { sharedId: 'shareid123', sharedUrl: 'https://agents.rox.one/s/shareid123', sharedOwnerKey: OWNER_KEY })
    const seen: { auth: string | null } = { auth: null }
    stubFetch((_url, init) => {
      seen.auth = new Headers(init?.headers).get('Authorization')
      return new Response(null, { status: 204 })
    })

    const result = await sm.revokeShare('s1')

    expect(result.success).toBe(true)
    expect(seen.auth).toBe(`Bearer ${OWNER_KEY}`)
    expect(managed.sharedOwnerKey).toBeUndefined()
    const onDisk = readSessionJsonl(join(root, 'sessions', 's1', 'session.jsonl'))
    expect(onDisk?.sharedOwnerKey).toBeUndefined()
    expect(onDisk?.sharedId).toBeUndefined()
  })

  it('surfaces LEGACY_SHARE_IMMUTABLE as a typed error on update', async () => {
    writeShareableSession(root, 's1')
    registerSession('s1', { sharedId: 'legacyid', sharedUrl: 'https://agents.rox.one/s/legacyid' })
    stubFetch(() => new Response(
      JSON.stringify({ error: 'legacy share is immutable', code: 'LEGACY_SHARE_IMMUTABLE' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    ))

    const result = await sm.updateShare('s1')

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('LEGACY_SHARE_IMMUTABLE')
    expect(result.error).toBeTruthy()
  })

  it('surfaces missing/invalid owner capability as a typed unauthorized error', async () => {
    writeShareableSession(root, 's1')
    registerSession('s1', { sharedId: 'shareid123', sharedUrl: 'https://agents.rox.one/s/shareid123' })
    stubFetch(() => new Response(
      JSON.stringify({ error: 'owner key required', code: 'SHARE_OWNER_KEY_REQUIRED' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    ))

    const result = await sm.updateShare('s1')

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('SHARE_OWNER_KEY_REQUIRED')
  })

  it('surfaces legacy immutability on revoke as well', async () => {
    writeShareableSession(root, 's1')
    registerSession('s1', { sharedId: 'legacyid', sharedUrl: 'https://agents.rox.one/s/legacyid' })
    stubFetch(() => new Response(
      JSON.stringify({ error: 'legacy share is immutable', code: 'LEGACY_SHARE_IMMUTABLE' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    ))

    const result = await sm.revokeShare('s1')

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('LEGACY_SHARE_IMMUTABLE')
  })

  it('managedToSession strips sharedOwnerKey from the renderer DTO', () => {
    const managed = createManagedSession({
      id: 's1',
      sharedId: 'shareid123',
      sharedUrl: 'https://agents.rox.one/s/shareid123',
      sharedOwnerKey: OWNER_KEY,
    }, workspace as never)

    const dto = managedToSession(managed)

    expect(dto.sharedId).toBe('shareid123')
    expect((dto as unknown as Record<string, unknown>).sharedOwnerKey).toBeUndefined()
    expect(JSON.stringify(dto)).not.toContain(OWNER_KEY)
  })
})

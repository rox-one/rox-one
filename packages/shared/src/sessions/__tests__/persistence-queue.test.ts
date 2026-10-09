import { afterEach, describe, it, expect, spyOn } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionHeader, StoredSession } from '../types'
import { SessionPersistenceQueue, getHeaderMetadataSignature, mergeHeaderWithExternalMetadata, sessionPersistenceQueue } from '../persistence-queue'
import { deleteSession, getOrCreateSessionById } from '../storage'

function makeHeader(overrides: Partial<SessionHeader> = {}): SessionHeader {
  return {
    id: 's1',
    workspaceRootPath: '~/.craft-agent/workspaces/ws',
    createdAt: 1,
    lastUsedAt: 2,
    messageCount: 0,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      contextTokens: 0,
    },
    ...overrides,
  }
}

describe('session persistence header conflict helpers', () => {
  it('metadata signature ignores non-metadata fields', () => {
    const a = makeHeader({ name: 'A', lastUsedAt: 100 })
    const b = makeHeader({ name: 'A', lastUsedAt: 999, messageCount: 42 })

    expect(getHeaderMetadataSignature(a)).toBe(getHeaderMetadataSignature(b))
  })

  it('metadata signature changes when metadata changes', () => {
    const a = makeHeader({ name: 'A', labels: ['x'] })
    const b = makeHeader({ name: 'B', labels: ['x'] })

    expect(getHeaderMetadataSignature(a)).not.toBe(getHeaderMetadataSignature(b))
  })

  it('merge preserves external metadata while keeping local computed fields', () => {
    const local = makeHeader({
      name: 'Local Name',
      labels: ['local'],
      isFlagged: false,
      sessionStatus: 'todo',
      permissionMode: 'allow-all',
      hasUnread: true,
      lastReadMessageId: 'm-local',
      messageCount: 99,
      lastUsedAt: 500,
    })

    const disk = makeHeader({
      name: 'Disk Name',
      labels: ['disk'],
      isFlagged: true,
      sessionStatus: 'needs-review',
      permissionMode: 'safe',
      hasUnread: false,
      lastReadMessageId: 'm-disk',
      messageCount: 1,
      lastUsedAt: 50,
    })

    const merged = mergeHeaderWithExternalMetadata(local, disk)

    expect(merged.name).toBe('Disk Name')
    expect(merged.labels).toEqual(['disk'])
    expect(merged.isFlagged).toBe(true)
    expect(merged.sessionStatus).toBe('needs-review')
    expect(merged.permissionMode).toBe('safe')
    expect(merged.hasUnread).toBe(false)
    expect(merged.lastReadMessageId).toBe('m-disk')

    // Local computed/runtime persistence fields remain local
    expect(merged.messageCount).toBe(99)
    expect(merged.lastUsedAt).toBe(500)
  })

  it('startup scenario: external metadata differs from local signature', () => {
    const local = makeHeader({ name: 'Local Name', labels: ['local'] })
    const disk = makeHeader({ name: 'External Name', labels: ['external'] })

    const localSig = getHeaderMetadataSignature(local)
    const diskSig = getHeaderMetadataSignature(disk)

    // This is the condition used by persistence queue at startup:
    // no previousSig yet, disk differs from local → preserve external metadata.
    const hasExternalMetadataChange = diskSig !== localSig
      && (undefined === undefined || diskSig !== undefined)

    expect(hasExternalMetadataChange).toBe(true)

    const merged = mergeHeaderWithExternalMetadata(local, disk)
    expect(merged.name).toBe('External Name')
    expect(merged.labels).toEqual(['external'])
  })
})

const lifecycleDirs: string[] = []

afterEach(() => {
  for (const dir of lifecycleDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function storedSession(id: string, workspaceRootPath: string, content: string): StoredSession {
  return {
    id,
    workspaceRootPath,
    createdAt: 1,
    lastUsedAt: 2,
    lastMessageAt: 2,
    messages: [{ id: 'm1', type: 'user', content, timestamp: 1 }],
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
  }
}

describe('session persistence seal lifecycle', () => {
  it('unseal after a successful delete lets a reused id persist again', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'session-unseal-'))
    lifecycleDirs.push(workspace)
    const id = '260111-swift-river'
    const file = join(workspace, 'sessions', id, 'session.jsonl')

    await getOrCreateSessionById(workspace, id)
    expect(existsSync(file)).toBe(true)

    // Mirror SessionManager.deleteSession's cancel -> delete ordering.
    await sessionPersistenceQueue.cancel(id)
    expect(deleteSession(workspace, id)).toBe(true)
    sessionPersistenceQueue.unseal(id)

    // The directory is gone, so the slug/id space is reusable; a new session
    // created with the same id must reach disk instead of being silently dropped.
    await getOrCreateSessionById(workspace, id)
    expect(existsSync(file)).toBe(true)
  })

  it('keeps the tombstone until unseal, blocking then allowing writes', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'session-sealed-'))
    lifecycleDirs.push(workspace)
    const id = '260111-quiet-river'
    const file = join(workspace, 'sessions', id, 'session.jsonl')

    const queue = new SessionPersistenceQueue(0)
    await queue.cancel(id)

    // Tombstone retained: a late enqueue (metadata echo) must stay dropped.
    queue.enqueue(storedSession(id, workspace, 'late'))
    expect(queue.hasPending(id)).toBe(false)
    await queue.flush(id)
    expect(existsSync(file)).toBe(false)

    // Only an explicit unseal (called after a successful delete) re-enables it.
    queue.unseal(id)
    queue.enqueue(storedSession(id, workspace, 'recreated'))
    await queue.flush(id)
    expect(existsSync(file)).toBe(true)
  })

  it('flushAll waits for every queued write and surfaces an aggregated failure', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'session-flushall-'))
    lifecycleDirs.push(workspace)
    const okId = '260111-ok-session'
    const failId = '260111-fail-session'
    const okFile = join(workspace, 'sessions', okId, 'session.jsonl')
    const failDest = join(workspace, 'sessions', failId, 'session.jsonl')

    // Occupy the failing session's destination with a directory so its rename
    // fails, while leaving the healthy session writable.
    mkdirSync(failDest, { recursive: true })

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    const queue = new SessionPersistenceQueue(0)
    let failure: unknown
    try {
      queue.enqueue(storedSession(failId, workspace, 'fail'))
      queue.enqueue(storedSession(okId, workspace, 'ok'))
      failure = await queue.flushAll().then(
        () => { throw new Error('expected flushAll() to reject when a write fails') },
        (error: Error) => error,
      )
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }

    // The healthy session was still written despite the failure (allSettled).
    expect(existsSync(okFile)).toBe(true)
    expect(String(failure)).toContain(failId)
    expect(String(failure)).toMatch(/1 of 2/)
  })
})

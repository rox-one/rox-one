import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSession } from '../storage.ts'
import {
  SESSION_LOAD_CACHE_LIMIT,
  resetSessionLoadCache,
  sessionLoadCacheSize,
} from '../session-load-cache.ts'

const tempDirs: string[] = []

beforeEach(() => {
  resetSessionLoadCache()
})

afterEach(() => {
  resetSessionLoadCache()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function header(id: string) {
  return {
    id,
    workspaceRootPath: '/tmp/ws',
    createdAt: 1,
    lastUsedAt: 2,
    messageCount: 1,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      contextTokens: 0,
    },
  }
}

function writeSession(workspaceRoot: string, id: string, content = 'hello') {
  const dir = join(workspaceRoot, 'sessions', id)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'session.jsonl')
  const lines = [
    JSON.stringify(header(id)),
    JSON.stringify({ id: 'm1', type: 'user', content, timestamp: 1 }),
  ]
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf-8')
  return file
}

describe('loadSession mtime cache (S9-09)', () => {
  it('reuses a transcript whose mtime and size have not changed', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'session-load-cache-'))
    tempDirs.push(workspace)
    writeSession(workspace, 'alpha', 'first')

    const a = loadSession(workspace, 'alpha')
    const b = loadSession(workspace, 'alpha')
    expect(a?.messages[0]?.content).toBe('first')
    expect(b).toBe(a)
    expect(sessionLoadCacheSize()).toBe(1)
  })

  it('re-reads when the journal mtime changes', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'session-load-cache-'))
    tempDirs.push(workspace)
    const file = writeSession(workspace, 'beta', 'before')
    const first = loadSession(workspace, 'beta')

    writeFileSync(
      file,
      `${JSON.stringify(header('beta'))}\n${JSON.stringify({ id: 'm1', type: 'user', content: 'after', timestamp: 1 })}\n`,
      'utf-8',
    )
    utimesSync(file, 1, 1_700_000_000)

    const reloaded = loadSession(workspace, 'beta')
    expect(reloaded?.messages[0]?.content).toBe('after')
    expect(reloaded).not.toBe(first)
  })

  it('evicts the least-recently-used transcript past the cap', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'session-load-cache-'))
    tempDirs.push(workspace)
    writeSession(workspace, 's-0')
    const first = loadSession(workspace, 's-0')
    for (let i = 1; i <= SESSION_LOAD_CACHE_LIMIT; i++) {
      writeSession(workspace, `s-${i}`)
      loadSession(workspace, `s-${i}`)
    }
    expect(sessionLoadCacheSize()).toBe(SESSION_LOAD_CACHE_LIMIT)
    const reloaded = loadSession(workspace, 's-0')
    expect(reloaded?.id).toBe('s-0')
    expect(reloaded).not.toBe(first)
  })
})

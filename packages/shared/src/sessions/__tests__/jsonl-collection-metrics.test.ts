import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionHeader, writeSessionJsonl } from '../jsonl.ts'
import { listSessions } from '../storage.ts'
import type { StoredSession } from '../types.ts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  }
})

function session(messages: StoredSession['messages'], id = 's-metrics'): StoredSession {
  return {
    id,
    workspaceRootPath: '/tmp/ws',
    createdAt: 1,
    lastUsedAt: 2,
    messages,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    },
  }
}

describe('createSessionHeader collection metrics', () => {
  it('precomputes toolCallCount and commitCount from transcript rows', () => {
    const header = createSessionHeader(session([
      { id: 'u1', type: 'user', content: 'hi' },
      { id: 't1', type: 'tool', content: '', toolName: 'Read' },
      { id: 't2', type: 'tool', content: '', toolName: 'Bash', toolInput: { command: 'git commit -m x' } },
      { id: 'a1', type: 'assistant', content: 'ok' },
    ]))
    expect(header.messageCount).toBe(4)
    expect(header.toolCallCount).toBe(2)
    expect(header.commitCount).toBe(1)
  })
})

describe('listSessions transcriptBytes', () => {
  it('attaches jsonl file size without persisting it on the header', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'list-size-'))
    tempDirs.push(workspace)
    const sessionDir = join(workspace, 'sessions', 's-size')
    mkdirSync(sessionDir, { recursive: true })
    const jsonl = join(sessionDir, 'session.jsonl')
    writeSessionJsonl(jsonl, session([{ id: 'u1', type: 'user', content: 'hello size' }], 's-size'))

    const listed = listSessions(workspace)
    const row = listed.find((item) => item.id === 's-size')
    expect(row?.transcriptBytes).toBe(statSync(jsonl).size)
    expect(row?.transcriptBytes).toBeGreaterThan(0)
    const headerLine = createSessionHeader(session([{ id: 'u1', type: 'user', content: 'hello size' }], 's-size'))
    expect(headerLine.transcriptBytes).toBeUndefined()
  })
})

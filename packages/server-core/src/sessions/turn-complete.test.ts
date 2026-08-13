import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import type { SessionEvent } from '@craft-agent/shared/protocol'
import { emitTurnComplete } from './turn-complete.ts'

const tokenUsage = {
  inputTokens: 1,
  outputTokens: 2,
  totalTokens: 3,
  contextTokens: 4,
  costUsd: 0.01,
}

describe('emitTurnComplete', () => {
  it('emits exactly one complete event for a mid-turn stop', () => {
    const events: SessionEvent[] = []
    emitTurnComplete(
      (event) => { events.push(event) },
      'ws_1',
      {
        sessionId: 's1',
        tokenUsage,
        backgroundTasksAlive: false,
      },
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: 'complete',
      sessionId: 's1',
      tokenUsage,
      backgroundTasksAlive: false,
    })
  })

  it('preserves onProcessingStopped optional fields without changing event shape', () => {
    const events: SessionEvent[] = []
    emitTurnComplete(
      (event) => { events.push(event) },
      'ws_1',
      {
        sessionId: 's1',
        tokenUsage,
        hasUnread: true,
        backgroundTasksAlive: true,
        reason: 'error',
        didReceiveNewFinalMessage: false,
      },
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: 'complete',
      sessionId: 's1',
      tokenUsage,
      hasUnread: true,
      backgroundTasksAlive: true,
      reason: 'error',
      didReceiveNewFinalMessage: false,
    })
  })

  it('passes the workspace id through to sendEvent', () => {
    const seen: string[] = []
    emitTurnComplete(
      (_event, workspaceId) => { seen.push(workspaceId) },
      'ws_target',
      { sessionId: 's1' },
    )
    expect(seen).toEqual(['ws_target'])
  })
})

describe('SessionManager complete-event seam', () => {
  it('routes renderer complete events through emitTurnComplete (no duplicate inline payloads)', async () => {
    const src = await Bun.file(join(import.meta.dir, 'SessionManager.ts')).text()
    expect(src).toContain('emitTurnComplete')
    expect(src).not.toMatch(/type:\s*['"]complete['"]/)
  })
})

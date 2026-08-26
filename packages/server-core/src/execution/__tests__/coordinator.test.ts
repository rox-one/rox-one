import { describe, expect, it } from 'bun:test'
import { ExecutionCoordinator } from '../coordinator.ts'
import type { PauseResult } from '../types.ts'

const BOTH_FLAGS = new Set(['workbench.terminal.v1', 'execution.coordinator.v1'])

function coordinator(flags: Set<string> = BOTH_FLAGS) {
  return new ExecutionCoordinator({ flags })
}

describe('ExecutionCoordinator', () => {
  it('returns FLAG_OFF from createRun when flags are missing', () => {
    expect(coordinator(new Set()).createRun('s1')).toEqual({ code: 'FLAG_OFF' })
  })

  it('returns FLAG_OFF from createRun when only one required flag is present', () => {
    expect(coordinator(new Set(['workbench.terminal.v1'])).createRun('s1')).toEqual({
      code: 'FLAG_OFF',
    })
    expect(coordinator(new Set(['execution.coordinator.v1'])).createRun('s1')).toEqual({
      code: 'FLAG_OFF',
    })
  })

  it('returns FLAG_OFF from attachTerminal when flags are missing', () => {
    expect(coordinator(new Set()).attachTerminal('t1', { kind: 'local-electron' })).toEqual({
      code: 'FLAG_OFF',
    })
  })

  it('rejects ssh hosts', () => {
    expect(coordinator().attachTerminal('t1', { kind: 'ssh' } as never)).toEqual({
      code: 'HOST_UNSUPPORTED',
    })
  })

  it('rejects relay hosts', () => {
    expect(coordinator().attachTerminal('t1', { kind: 'relay' } as never)).toEqual({
      code: 'HOST_UNSUPPORTED',
    })
  })

  it('pause honesty — unsupported when PTY cannot pause', async () => {
    expect(await coordinator().pause('t1')).toBe('unsupported')
  })

  it('pause result is one of the four allowed strings', async () => {
    const allowed: PauseResult[] = ['paused', 'partial', 'unsupported', 'failed']
    const result = await coordinator().pause('t1')
    expect(allowed).toContain(result)
  })

  it('does not create WorkItem', () => {
    const run = coordinator().createRun('s1')
    expect(run).not.toEqual({ code: 'FLAG_OFF' })
    expect(run).not.toEqual({ code: 'HOST_UNSUPPORTED' })
    if (typeof run !== 'object' || run === null || !('id' in run)) {
      throw new Error('expected ExecutionRun')
    }
    expect(typeof run.id).toBe('string')
    expect('workItemId' in run).toBe(false)
    expect('__workitems' in globalThis).toBe(false)
  })

  it('createRun returns ExecutionRun with id', () => {
    const run = coordinator().createRun('s1')
    if (typeof run !== 'object' || run === null || !('id' in run) || !('createdAt' in run)) {
      throw new Error('expected ExecutionRun')
    }
    if (typeof run.id !== 'string' || typeof run.createdAt !== 'number') {
      throw new Error('expected ExecutionRun fields')
    }
    expect(run.id.length).toBeGreaterThan(0)
    expect('sessionId' in run && run.sessionId === 's1').toBe(true)
    expect(run.createdAt).toBeGreaterThan(0)
  })

  it('attachTerminal admits local-electron and returns an epoch', () => {
    expect(coordinator().attachTerminal('t1', { kind: 'local-electron' })).toEqual({ epoch: 1 })
  })
})

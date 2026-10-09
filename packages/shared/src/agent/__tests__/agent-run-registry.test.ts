/**
 * Agent run registry tests (row f.5) — locks the `agent` / `agent.wait`
 * contract: an immediate runId correlates to exactly one terminal outcome, and
 * `wait` resolves only once that specific run reaches a terminal state.
 */

import { describe, expect, it } from 'bun:test'
import { AgentRunRegistry } from '../agent-run-registry'

describe('AgentRunRegistry', () => {
  it('wait resolves only on terminal state and correlates strictly by runId', async () => {
    const registry = new AgentRunRegistry()
    registry.begin('r1')
    registry.begin('r2')

    let r1Settled = false
    const wait1 = registry.wait('r1').then((state) => { r1Settled = true; return state })
    const wait2 = registry.wait('r2')

    await Promise.resolve()
    await Promise.resolve()
    expect(r1Settled).toBe(false)

    // Finishing a different run must not resolve r1's wait.
    registry.finish('r2', 'ok')
    expect((await wait2).runId).toBe('r2')
    expect(r1Settled).toBe(false)

    registry.finish('r1', 'error', 'boom')
    const state1 = await wait1
    expect(state1).toMatchObject({ runId: 'r1', status: 'error', error: 'boom' })
    expect(state1.endedAt).toBeGreaterThanOrEqual(state1.startedAt)
  })

  it('resolves immediately when the run is already terminal', async () => {
    const registry = new AgentRunRegistry()
    registry.begin('r')
    const terminal = registry.finish('r', 'ok')
    expect(await registry.wait('r')).toEqual(terminal)
  })

  it('rejects a wait for a run that was never begun', async () => {
    const registry = new AgentRunRegistry()
    await expect(registry.wait('nope')).rejects.toThrow('was never begun')
  })

  it('guards begin/finish bookkeeping', () => {
    const registry = new AgentRunRegistry()
    registry.begin('r')
    expect(() => registry.begin('r')).toThrow('already active')
    registry.finish('r', 'aborted', 'user stop')
    expect(() => registry.finish('r', 'ok')).toThrow('already finished')
    expect(() => registry.finish('other', 'ok')).toThrow('never begun')
    expect(registry.peek('r')).toMatchObject({ status: 'aborted', error: 'user stop' })
  })
})
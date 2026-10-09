import { afterEach, describe, expect, test } from 'bun:test'
import { notifyRepoMutation, setRepoNotifier, type RepoBankRef } from '../notify'

afterEach(() => setRepoNotifier(null))

describe('notify seam', () => {
  test('is a no-op when no notifier is wired', () => {
    expect(() => notifyRepoMutation({ scope: 'main' }, 'rpc')).not.toThrow()
  })

  test('forwards the bank ref and reason', () => {
    const calls: Array<{ bank: RepoBankRef; reason: string }> = []
    setRepoNotifier((bank, reason) => calls.push({ bank, reason }))
    notifyRepoMutation({ scope: 'main' }, 'session')
    notifyRepoMutation({ scope: 'workspace', workspaceId: 'ws-1' }, 'dream')
    expect(calls).toEqual([
      { bank: { scope: 'main' }, reason: 'session' },
      { bank: { scope: 'workspace', workspaceId: 'ws-1' }, reason: 'dream' },
    ])
  })

  test('never throws when the notifier throws', () => {
    setRepoNotifier(() => {
      throw new Error('boom')
    })
    expect(() => notifyRepoMutation({ scope: 'main' }, 'rpc')).not.toThrow()
  })

  test('setRepoNotifier(null) detaches the notifier', () => {
    let called = 0
    setRepoNotifier(() => called++)
    setRepoNotifier(null)
    notifyRepoMutation({ scope: 'main' }, 'rpc')
    expect(called).toBe(0)
  })
})
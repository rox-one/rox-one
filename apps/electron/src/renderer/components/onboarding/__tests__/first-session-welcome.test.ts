import { describe, expect, it } from 'bun:test'
import type { Session } from '../../../../shared/types'
import { openFirstSessionWelcome } from '../first-session-welcome'

function harness() {
  const session = { id: 'welcome', workspaceId: 'ws', messages: [{ role: 'assistant', content: 'Hello' }] } as Session
  const calls: string[] = []
  const ports = {
    workspaceId: 'ws',
    isCurrent: () => true,
    getWindowWorkspace: async () => 'ws' as string | null,
    ensureWelcome: async () => { calls.push('create'); return session as Session | null },
    onSession: () => { calls.push('add') },
    onOpen: () => { calls.push('open') },
  }
  return { ports, calls }
}

describe('opening the initial assistant conversation', () => {
  it('adds and opens the persisted greeting without sending a user message', async () => {
    const { ports, calls } = harness()
    await openFirstSessionWelcome(ports)
    expect(calls).toEqual(['create', 'add', 'open'])
  })

  it('does not request host session creation for an unavailable caller or different workspace', async () => {
    const { ports, calls } = harness()
    ports.isCurrent = () => false
    await openFirstSessionWelcome(ports)
    ports.isCurrent = () => true
    ports.getWindowWorkspace = async () => 'other'
    await openFirstSessionWelcome(ports)
    expect(calls).toEqual([])
  })

  it('does not open an outdated response after switching workspaces', async () => {
    const { ports, calls } = harness()
    ports.ensureWelcome = async () => {
      calls.push('create')
      ports.getWindowWorkspace = async () => 'other'
      return { id: 'welcome' } as Session
    }
    await openFirstSessionWelcome(ports)
    expect(calls).toEqual(['create'])
  })

  it('leaves the current screen alone when the greeting was already completed', async () => {
    const { ports, calls } = harness()
    ports.ensureWelcome = async () => null
    await openFirstSessionWelcome(ports)
    expect(calls).toEqual([])
  })
})

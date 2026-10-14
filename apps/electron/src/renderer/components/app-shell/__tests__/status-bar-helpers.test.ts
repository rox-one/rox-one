import { describe, expect, it } from 'bun:test'
import { applyDefaultConnection, pickLatestInboxItem } from '../StatusBar'
import type { InboxItem, InboxState } from '@/pages/inbox/inbox-model'

const item = (id: string) => ({ id }) as unknown as InboxItem
const state = (over: Partial<InboxState>) => ({ done: {}, snoozed: {}, ...over }) as unknown as InboxState

describe('pickLatestInboxItem', () => {
  const items = [item('a'), item('b'), item('c')]
  it('skips done items and still-snoozed items', () => {
    expect(pickLatestInboxItem(items, state({ done: { a: 1 } as never, snoozed: { b: 2000 } }), 1000)?.id).toBe('c')
  })
  it('treats an expired snooze as active', () => {
    expect(pickLatestInboxItem(items, state({ snoozed: { a: 500 } }), 1000)?.id).toBe('a')
  })
  it('returns undefined when nothing is active', () => {
    expect(pickLatestInboxItem(items, state({ done: { a: 1, b: 1, c: 1 } as never }), 1000)).toBeUndefined()
  })
})

describe('applyDefaultConnection', () => {
  it('uses the workspace setter and refreshes on success', async () => {
    const calls: string[] = []
    const ok = await applyDefaultConnection({
      setWorkspaceDefaultLlmConnection: async (ws, slug) => { calls.push(`ws:${ws}:${slug}`); return { success: true } },
      setDefaultLlmConnection: async () => { calls.push('global'); return { success: true } },
    }, 'w1', 'rox', () => { calls.push('refresh') })
    expect(ok).toBe(true)
    expect(calls).toEqual(['ws:w1:rox', 'refresh'])
  })
  it('falls back to the global setter without a workspace and skips refresh on failure', async () => {
    let refreshed = false
    const ok = await applyDefaultConnection({ setDefaultLlmConnection: async () => ({ success: false }) }, undefined, 'x', () => { refreshed = true })
    expect(ok).toBe(false)
    expect(refreshed).toBe(false)
  })
  it('never rejects when the IPC or refresh throws', async () => {
    const orig = console.warn
    console.warn = () => {}
    try {
      await expect(applyDefaultConnection({ setDefaultLlmConnection: async () => { throw new Error('ipc') } }, undefined, 'x')).resolves.toBe(false)
      await expect(applyDefaultConnection({ setDefaultLlmConnection: async () => ({ success: true }) }, undefined, 'x', async () => { throw new Error('refresh') })).resolves.toBe(false)
    } finally { console.warn = orig }
  })
})

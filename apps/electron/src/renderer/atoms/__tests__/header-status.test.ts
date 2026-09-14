import { describe, expect, it, mock } from 'bun:test'
import { createStore } from 'jotai'
import type { Session } from '../../../shared/types'
import { headerStatusDuration, type HeaderStatus } from '../../lib/header-status'
import { dismissHeaderStatusAtom, headerStatusAtom, publishHeaderStatusAtom, recordSuccessfulCompletionAtom, reusableProcessesAtom } from '../header-status'

const status = (extra: Partial<HeaderStatus> = {}): HeaderStatus => ({
  id: 'saved', workspaceId: 'workspace', tone: 'success', messageKey: 'headerStatus.completed', createdAt: 1_000,
  ...extra,
})

describe('header status lifecycle', () => {
  it('deduplicates success and safely replaces it with the latest signal', () => {
    const store = createStore()
    store.set(publishHeaderStatusAtom, status())
    const first = store.get(headerStatusAtom)
    store.set(publishHeaderStatusAtom, status({ createdAt: 2_000 }))
    expect(store.get(headerStatusAtom)).toBe(first)
    store.set(publishHeaderStatusAtom, status({ id: 'new', createdAt: 3_000 }))
    store.set(dismissHeaderStatusAtom, 'saved')
    expect(store.get(headerStatusAtom).current?.id).toBe('new')
    store.set(dismissHeaderStatusAtom, 'new')
    expect(store.get(headerStatusAtom).current).toBeNull()
  })

  it('expires ordinary status messages while retaining actions and errors until resolved', () => {
    expect(headerStatusDuration(status())).toBe(5_000)
    expect(headerStatusDuration(status({ tone: 'info' }))).toBe(5_000)
    expect(headerStatusDuration(status({ tone: 'error' }))).toBeNull()
    expect(headerStatusDuration(status({ action: { labelKey: 'common.retry', onClick: () => {} } }))).toBeNull()
  })

  it('does not invoke an action or replace an unresolved error on a new success', () => {
    const store = createStore()
    const action = mock(() => {})
    store.set(publishHeaderStatusAtom, status({ tone: 'error', action: { labelKey: 'common.retry', onClick: action } }))
    store.set(publishHeaderStatusAtom, status({ id: 'success', createdAt: 2_000 }))
    expect(store.get(headerStatusAtom).current?.tone).toBe('error')
    expect(action).not.toHaveBeenCalled()
    store.set(dismissHeaderStatusAtom, 'saved')
    expect(store.get(headerStatusAtom).current).toBeNull()
  })

  it('lets errors take priority over an action and ignores later routine signals', () => {
    const store = createStore()
    store.set(publishHeaderStatusAtom, status({ action: { labelKey: 'common.retry', onClick: () => {} } }))
    store.set(publishHeaderStatusAtom, status({ id: 'error', tone: 'error', createdAt: 2_000 }))
    for (let index = 0; index < 100; index++) {
      store.set(publishHeaderStatusAtom, status({ id: `routine-${index}`, createdAt: 3_000 + index }))
    }
    expect(store.get(headerStatusAtom).current?.id).toBe('error')
  })

  it('does not let an unresolved status from another workspace block the active workspace', () => {
    const store = createStore()
    store.set(publishHeaderStatusAtom, status({ tone: 'error' }))
    store.set(publishHeaderStatusAtom, status({ id: 'other', workspaceId: 'second-workspace', createdAt: 2_000 }))
    expect(store.get(headerStatusAtom).current?.workspaceId).toBe('second-workspace')
  })
})

const completedSession = (): Session => ({
  id: 'chat', workspaceId: 'workspace', workspaceName: 'Workspace', isProcessing: false, lastMessageAt: 1_000,
  messages: [
    { id: 'user', role: 'user', timestamp: 1, content: 'Review the code and verify the change.' },
    { id: 'tool1', role: 'tool', timestamp: 2, content: '', toolStatus: 'completed' },
    { id: 'tool2', role: 'tool', timestamp: 3, content: '', toolStatus: 'completed' },
    { id: 'final', role: 'assistant', timestamp: 4, content: 'The changes are complete and verified. Both requested behaviors now work.' },
  ],
})

describe('completion integration', () => {
  it('records a reusable process and completion status from the updated session', () => {
    const store = createStore()
    const input = { session: completedSession(), event: { reason: 'complete' }, title: 'Review', notifyInHeader: true, now: 1_000 }
    store.set(recordSuccessfulCompletionAtom, input)
    expect(store.get(headerStatusAtom).current?.messageKey).toBe('headerStatus.completed')
    expect(store.get(reusableProcessesAtom).chat?.completedAt).toBe(1_000)
    store.set(recordSuccessfulCompletionAtom, { ...input, now: 2_000 })
    expect(store.get(reusableProcessesAtom).chat?.completedAt).toBe(1_000)
    expect(store.get(headerStatusAtom).current?.createdAt).toBe(1_000)
  })

  it('keeps background completion available without duplicating its existing notification', () => {
    const store = createStore()
    store.set(recordSuccessfulCompletionAtom, { session: completedSession(), event: {}, title: 'Review', notifyInHeader: false, now: 1_000 })
    expect(store.get(headerStatusAtom).current).toBeNull()
    expect(store.get(reusableProcessesAtom).chat?.finalMessageId).toBe('final')
  })

  it('cannot create a success status from an interrupted or hidden session', () => {
    const store = createStore()
    for (const input of [
      { session: completedSession(), event: { reason: 'interrupted' } },
      { session: { ...completedSession(), hidden: true }, event: {} },
      { session: completedSession(), event: { didReceiveNewFinalMessage: false } },
    ]) {
      store.set(recordSuccessfulCompletionAtom, { ...input, title: 'Review', notifyInHeader: true, now: 1_000 })
    }
    expect(store.get(headerStatusAtom).current).toBeNull()
    expect(store.get(reusableProcessesAtom)).toEqual({})
  })
})

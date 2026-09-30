import { describe, expect, it } from 'bun:test'
import {
  buildInboxItems,
  EMPTY_INBOX_STATE,
  filterInbox,
  inboxCounts,
  markDone,
  pruneInboxState,
  reopen,
  snooze,
  snoozeTargets,
  sortInbox,
  type InboxItem,
} from '../inbox-model'

const NOW = new Date(2026, 8, 29, 15, 0).getTime() // Tue

function sources() {
  return {
    sessions: [
      { id: 's1', name: 'Deploy', lastMessageRole: 'assistant', hasUnread: true, lastMessageAt: NOW - 1000, lastFinalMessageId: 'm1' },
      { id: 's2', name: 'Refactor', lastMessageRole: 'plan', lastMessageAt: NOW - 5000, lastFinalMessageId: 'm2' },
      { id: 's3', name: 'Busy', lastMessageRole: 'plan', isProcessing: true },
      { id: 's4', name: 'Broken', lastMessageRole: 'error', hasUnread: true, lastMessageAt: NOW - 2000 },
      { id: 's5', name: 'Read', lastMessageRole: 'assistant', hasUnread: false },
    ],
    permissions: new Map([['s1', [{ requestId: 'r1', sessionId: 's1', toolName: 'Bash', command: 'git push', description: 'push' }]]]),
    credentials: new Map([['s2', [{ requestId: 'c1', sessionId: 's2', sourceSlug: 'linear', sourceName: 'Linear' }]]]),
    memoryProposals: [
      { id: 'p1', text: 'Prefer bun', status: 'pending', sessionId: 's1', createdAt: new Date(NOW - 9000).toISOString() },
      { id: 'p2', text: 'Old', status: 'rejected', sessionId: 's1', createdAt: new Date(NOW).toISOString() },
    ],
    pendingSkills: [{ slug: 'deploy-helper', description: 'Deploys' }],
    pendingSenders: [{ platform: 'telegram', userId: '42', displayName: 'Anna', lastAttemptAt: NOW - 100, attemptCount: 2 }],
    firstSeen: new Map([['perm:s1:r1', NOW - 60_000], ['cred:s2:c1', NOW - 30_000]]),
    now: NOW,
  }
}

describe('inbox aggregation', () => {
  it('normalizes every live source into typed items', () => {
    const items = buildInboxItems(sources())
    const kinds = items.map((i) => i.kind).sort()
    expect(kinds).toEqual(['credential', 'error', 'memory', 'permission', 'plan', 'reply', 'sender', 'skill'])
    const perm = items.find((i) => i.kind === 'permission')!
    expect(perm).toMatchObject({ id: 'perm:s1:r1', blocking: true, title: 'git push', source: 'Deploy', sessionId: 's1' })
    expect(items.find((i) => i.kind === 'sender')?.title).toBe('Anna')
    // processing plan sessions and read sessions are not items
    expect(items.some((i) => i.sessionId === 's3' || i.sessionId === 's5')).toBe(false)
  })
  it('preserves delivered team request identity and exact target revision', () => {
    const request = {
      id: 'team-recipient:org-a:req-1',
      kind: 'recipient-request' as const,
      fromUserId: 'subject-a',
      organizationId: 'org-a',
      requestId: 'req-1',
      target: { kind: 'mapNode' as const, id: 'node-7', revision: 'map-rev-4', title: 'Milestone' },
      at: NOW - 30,
      delivery: 'delivered' as const,
    }
    const items = buildInboxItems({ ...sources(), teamInbox: [request, { ...request, at: NOW - 20 }] })
    const [item] = items.filter((entry) => entry.kind === 'team-recipient')
    expect(items.filter((entry) => entry.kind === 'team-recipient')).toHaveLength(1)
    expect(item).toMatchObject({
      id: 'team-recipient:org-a:req-1',
      kind: 'team-recipient',
      group: 'decision',
      sourceRef: {
        domain: 'team-recipient',
        organizationId: 'org-a',
        requestId: 'req-1',
        targetKind: 'mapNode',
        targetId: 'node-7',
        targetRevision: 'map-rev-4',
      },
      data: request,
    })
    expect(buildInboxItems({ ...sources(), teamInbox: [] }).some((entry) => entry.kind === 'team-recipient')).toBe(false)
  })


  it('orders blocking requests by longest wait, then decisions, then newest messages', () => {
    const items = buildInboxItems(sources())
    expect(items.slice(0, 3).map((i) => i.id)).toEqual(['perm:s1:r1', 'cred:s2:c1', 'plan:s2:m2'])
    const messages = items.filter((i) => i.group === 'message').map((i) => i.kind)
    expect(messages).toEqual(['reply', 'error'])
  })

  it('counts blocking items for the pill badge and respects done/snooze', () => {
    const items = buildInboxItems(sources())
    let state = EMPTY_INBOX_STATE
    expect(inboxCounts(items, state, NOW).blocking).toBe(3)
    state = snooze(state, 'plan:s2:m2', NOW + 1000)
    state = markDone(state, 'reply:s1:m1', NOW)
    const counts = inboxCounts(items, state, NOW)
    expect(counts.blocking).toBe(2)
    expect(counts.snoozed).toBe(1)
    expect(counts.done).toBe(1)
    expect(filterInbox(items, state, 'snoozed', NOW).map((i) => i.id)).toEqual(['plan:s2:m2'])
    expect(filterInbox(items, state, 'done', NOW).map((i) => i.id)).toEqual(['reply:s1:m1'])
    expect(filterInbox(items, state, { kind: 'reply' }, NOW)).toEqual([])
    // snooze expires
    expect(inboxCounts(items, state, NOW + 2000).blocking).toBe(3)
    expect(filterInbox(items, reopen(state, 'reply:s1:m1'), 'messages', NOW).length).toBe(2)
  })

  it('prunes state for resolved items and expired snoozes only', () => {
    const state = { done: { a: 1, gone: 1 }, snoozed: { b: NOW + 10, old: NOW - 10 } }
    expect(pruneInboxState(state, new Set(['a', 'b', 'old']), NOW)).toEqual({ done: { a: 1 }, snoozed: { b: NOW + 10 } })
    const stable = { done: { a: 1 }, snoozed: {} }
    expect(pruneInboxState(stable, new Set(['a']), NOW)).toBe(stable)
  })

  it('computes snooze targets', () => {
    const t = snoozeTargets(NOW)
    expect(t.laterToday).toBe(NOW + 3 * 3_600_000)
    expect(new Date(t.tomorrow).getDate()).toBe(30)
    expect(new Date(t.tomorrow).getHours()).toBe(9)
    expect(new Date(t.nextWeek).getDay()).toBe(1)
    expect(new Date(t.nextWeek).getDate()).toBe(5)
  })

  it('sortInbox is stable for equal ranks', () => {
    const a: InboxItem = { id: 'a', kind: 'reply', group: 'message', blocking: false, title: 'a', source: '', at: 1 }
    const b: InboxItem = { ...a, id: 'b', at: 2 }
    expect(sortInbox([a, b]).map((i) => i.id)).toEqual(['b', 'a'])
  })
})

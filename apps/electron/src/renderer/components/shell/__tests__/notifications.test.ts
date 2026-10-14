import { useDomForFile as installDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { beforeEach, describe, expect, it } from 'bun:test'

installDom()

const n = await import('../notifications')
const src = await import('../notification-sources')

describe('notification center model (top50 #9)', () => {
  beforeEach(() => {
    localStorage.clear()
    n.resetNotificationsCache()
  })

  it('push / unread / markRead / markAll / clear, scoped per workspace, persisted', () => {
    n.pushNotification({ kind: 'agent', title: 'A', workspaceId: 'w1' })
    n.pushNotification({ kind: 'balance', title: 'B' })
    const other = n.pushNotification({ kind: 'automation', title: 'C', workspaceId: 'w2' })
    expect(n.getNotifications().filter((x) => n.inScope(x, 'w1')).map((x) => x.title)).toEqual(['B', 'A'])
    n.markNotificationRead(other.id)
    n.resetNotificationsCache()
    expect(n.getNotifications().find((x) => x.id === other.id)?.read).toBe(true)
    n.markAllNotificationsRead('w1')
    expect(n.getNotifications().filter((x) => !x.read)).toEqual([])
    n.clearNotifications('w1')
    expect(n.getNotifications().map((x) => x.title)).toEqual(['C'])
  })

  it('dedupes by key, caps the log, honours read on push', () => {
    n.pushNotification({ kind: 'agent', title: 'old', dedupeKey: 'agent:s1' })
    n.pushNotification({ kind: 'error', title: 'new', dedupeKey: 'agent:s1', read: true })
    expect(n.getNotifications().map((x) => [x.title, x.read])).toEqual([['new', true]])
    for (let i = 0; i < n.MAX_NOTIFICATIONS + 5; i++) n.pushNotification({ kind: 'agent', title: String(i) })
    expect(n.getNotifications().length).toBe(n.MAX_NOTIFICATIONS)
  })

  it('drops malformed persisted entries', () => {
    expect(n.sanitizeNotifications([{ id: 'x', title: 't', at: 1, kind: 'nope' }, null, { id: 'y', title: 't', at: 2, kind: 'agent' }]).map((x) => x.id)).toEqual(['y'])
  })
})

describe('notification sources', () => {
  it('first look records a baseline; later runs are new', () => {
    expect(src.diffAutomationRuns(undefined, { a: { ts: 5, ok: true } })).toEqual([])
    expect(src.diffAutomationRuns({ a: 5 }, { a: { ts: 5, ok: true }, b: { ts: 7, ok: false }, c: { ts: 9, ok: true } })).toEqual([
      { id: 'b', ts: 7, ok: false },
      { id: 'c', ts: 9, ok: true },
    ])
  })

  it('low balance fires once per crossing', () => {
    expect(src.nextBalanceLow(undefined, 1)).toEqual({ low: false, fire: false })
    expect(src.nextBalanceLow(false, 0.2)).toEqual({ low: true, fire: true })
    expect(src.nextBalanceLow(true, 0)).toEqual({ low: true, fire: false })
    expect(src.nextBalanceLow(true, 0.21)).toEqual({ low: false, fire: false })
    expect(src.nextBalanceLow(false, 0.2000001)).toEqual({ low: false, fire: false })
    expect(src.formatUsd(0.19)).toBe('$0.19')
    expect(src.formatUsd(-1)).toBe('$0.00')
  })
})

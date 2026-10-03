import { describe, expect, it } from 'bun:test'
import { CalendarStore } from '../store.ts'
import { FixtureCalendarAdapter, type CalendarListPage } from '../adapters.ts'

class DeferredCalendarAdapter extends FixtureCalendarAdapter {
  readonly pending: Array<{ accountId: string; cursor?: string; resolve: (page: CalendarListPage) => void; reject: (error: Error) => void }> = []

  constructor() { super('google') }

  override listEvents(accountId: string, cursor?: string): Promise<CalendarListPage> {
    return new Promise((resolve, reject) => { this.pending.push({ accountId, cursor, resolve, reject }) })
  }
}

function page(accountId: string, title: string, cursor: string, deleted = false): CalendarListPage {
  return { cursor, events: [{ id: 'shared', accountId, calendarId: 'primary', title, startAt: 1000, endAt: 2000, allDay: false, timeZone: 'UTC', deleted, etag: cursor, kind: 'event' }] }
}

function connected(store: CalendarStore, name: string) {
  const account = store.connect('google', name, 'UTC')
  store.markConnected(account.id)
  return account
}

describe('calendar sync request ownership', () => {
  it('keeps the newer event and cursor when an older sync finishes last', async () => {
    const store = new CalendarStore()
    const account = connected(store, 'Work')
    const adapter = new DeferredCalendarAdapter()
    const older = store.sync(account.id, adapter, 10)
    const newer = store.sync(account.id, adapter, 20)
    adapter.pending[1]!.resolve(page(account.id, 'Newer', 'new'))
    await newer
    const accepted = store.snapshot()
    adapter.pending[0]!.resolve(page(account.id, 'Stale', 'old', true))
    await older
    expect(store.snapshot()).toEqual(accepted)
    expect(store.events()[0]?.title).toBe('Newer')
    expect(store.snapshot().journals[0]).toMatchObject({ cursor: 'new', lastSyncAt: 20, lastSyncedRevision: 'new' })
  })

  it('does not replace the newer conflict snapshot with a stale response', async () => {
    const store = new CalendarStore()
    const account = connected(store, 'Work')
    await store.sync(account.id, new FixtureCalendarAdapter('google', [{ id: 'shared', title: 'Local', startAt: 1000, endAt: 2000, etag: 'seed' }]))
    store.markLocalDirty(store.events()[0]!)
    const adapter = new DeferredCalendarAdapter()
    const older = store.sync(account.id, adapter, 10)
    const newer = store.sync(account.id, adapter, 20)
    adapter.pending[1]!.resolve(page(account.id, 'Newer', 'new'))
    await newer
    const accepted = store.snapshot()
    adapter.pending[0]!.resolve(page(account.id, 'Stale', 'old', true))
    await older
    expect(store.snapshot()).toEqual(accepted)
    expect(store.conflicts()).toHaveLength(1)
    expect(store.conflicts()[0]?.remoteEvent?.title).toBe('Newer')
    expect(store.conflicts()[0]?.kind).toBe('update')
  })

  it('does not let an older request commit after the newer request fails', async () => {
    const store = new CalendarStore()
    const account = connected(store, 'Work')
    const adapter = new DeferredCalendarAdapter()
    const older = store.sync(account.id, adapter)
    const newer = store.sync(account.id, adapter)
    adapter.pending[1]!.reject(new Error('Provider unavailable'))
    await expect(newer).rejects.toThrow('Provider unavailable')
    const accepted = store.snapshot()
    adapter.pending[0]!.resolve(page(account.id, 'Stale', 'old'))
    await older
    expect(store.snapshot()).toEqual(accepted)
  })

  it('keeps independent account syncs and drops revoked in-flight responses', async () => {
    const store = new CalendarStore()
    const first = connected(store, 'Work')
    const second = connected(store, 'Personal')
    const adapter = new DeferredCalendarAdapter()
    const work = store.sync(first.id, adapter)
    const personal = store.sync(second.id, adapter)
    store.revoke(first.id)
    adapter.pending[1]!.resolve(page(second.id, 'Personal', 'personal'))
    adapter.pending[0]!.resolve(page(first.id, 'Revoked', 'work'))
    await Promise.all([work, personal])
    expect(store.events()).toHaveLength(1)
    expect(store.events()[0]?.accountId).toBe(second.id)
    expect(store.snapshot().journals[0]?.cursor).toBeUndefined()
    expect(store.snapshot().journals[1]?.cursor).toBe('personal')
  })
})

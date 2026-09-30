import { describe, expect, test } from 'bun:test'
import { capabilityErrorCode, readScopedCapability, subscribeOptionalCapability } from '../scoped-capability-read'
import { hasNativeNotesTransport } from '../notes-capability'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('scoped UI capability reads', () => {
  test('denied notes/assets stay unavailable instead of publishing an available empty list', async () => {
    for (const code of ['AUTH_FAILED', 'LOCAL_ONLY_DENIED', 'CHANNEL_NOT_FOUND']) {
      const refused = { code, message: 'refused by actual capability boundary' }
      const available: unknown[] = [], unavailable: unknown[] = []
      await readScopedCapability({ read: async () => { throw refused }, isCurrent: () => true,
        onAvailable: value => available.push(value), onUnavailable: error => unavailable.push(error) })
      expect(available).toEqual([])
      expect(unavailable).toEqual([refused])
      expect(capabilityErrorCode(unavailable[0])).toBe(code)
    }
  })

  test('real successful data and retry are retained; actual empty is available only after successful read', async () => {
    const events: unknown[] = []
    const notes = [{ id: 'actual-note', title: 'Retained title' }]
    const options = { isCurrent: () => true, onAvailable: (value: unknown) => events.push(value),
      onUnavailable: (error: unknown) => events.push(error) }
    const error = Object.assign(new Error('unavailable'), { code: 'AUTH_FAILED' })
    await readScopedCapability({ ...options, read: async () => { throw error } })
    await readScopedCapability({ ...options, read: async () => notes })
    await readScopedCapability({ ...options, read: async () => [] })
    expect(events).toEqual([error, notes, []])
    expect(events[1]).toBe(notes)
  })

  test('a newer request, workspace switch or unmount suppresses late success and denial', async () => {
    for (const cancel of ['new-request', 'workspace-switch', 'unmount']) {
      for (const refuse of [false, true]) {
        let mounted = true, workspace = 'a', request = 1
        const pending = deferred<string[]>(), events: unknown[] = []
        const running = readScopedCapability({ read: () => pending.promise,
          isCurrent: () => mounted && workspace === 'a' && request === 1,
          onAvailable: value => events.push(value), onUnavailable: error => events.push(error) })
        if (cancel === 'new-request') request++
        if (cancel === 'workspace-switch') workspace = 'b'
        if (cancel === 'unmount') mounted = false
        if (refuse) pending.reject({ code: 'AUTH_FAILED' }); else pending.resolve(['late-a'])
        await running
        expect(events).toEqual([])
      }
    }
  })

  test('an obsolete request does not call the transport; synchronous read failures remain explicit', async () => {
    let calls = 0, failure: unknown
    await readScopedCapability({ read: async () => { calls++; return [] }, isCurrent: () => false,
      onAvailable: () => { throw new Error('stale result') }, onUnavailable: () => { throw new Error('stale denial') } })
    expect(calls).toBe(0)
    const error = new Error('missing preload method')
    await readScopedCapability({ read: () => { throw error }, isCurrent: () => true,
      onAvailable: () => { throw new Error('false success') }, onUnavailable: value => { failure = value } })
    expect(failure).toBe(error)
    expect(capabilityErrorCode(failure)).toBe('CAPABILITY_UNAVAILABLE')
  })

  test('genuine onAvailable programming errors are not disguised as capability denials', async () => {
    let denial = false
    await expect(readScopedCapability({ read: async () => ['note'], isCurrent: () => true,
      onAvailable: () => { throw new Error('callback bug') }, onUnavailable: () => { denial = true } })).rejects.toThrow('callback bug')
    expect(denial).toBe(false)
  })
})

describe('optional real preload subscription', () => {
  test('missing subscription installs no event or capability and cleanup is safe', () => {
    let events = 0
    const stop = subscribeOptionalCapability(undefined, () => { events++ })
    stop(); stop()
    expect(events).toBe(0)
  })
  test('real Electron subscription is preserved and disposed once; late events are ignored', () => {
    let emit!: () => void, subscriptions = 0, disposed = 0
    const events: string[] = []
    const stop = subscribeOptionalCapability(listener => {
      subscriptions++; emit = listener; return () => { disposed++ }
    }, () => events.push('actual-authority-changed'))
    emit()
    stop(); stop(); emit()
    expect(subscriptions).toBe(1)
    expect(disposed).toBe(1)
    expect(events).toEqual(['actual-authority-changed'])
  })
})

test('coded subscription refusal is unavailable; synchronous listener bugs remain visible', () => {
  const refused = { code: 'CHANNEL_NOT_FOUND' }
  const unavailable: unknown[] = []
  const stop = subscribeOptionalCapability(() => { throw refused }, () => { throw new Error('event should not fire') }, error => unavailable.push(error))
  stop()
  expect(unavailable).toEqual([refused])
  const bug = Object.assign(new Error('listener bug'), { code: 'AUTH_FAILED' })
  expect(() => subscribeOptionalCapability(listener => { listener(); return () => {} }, () => { throw bug }, error => unavailable.push(error))).toThrow('listener bug')
  expect(unavailable).toEqual([refused])
  expect(() => subscribeOptionalCapability(() => { throw new Error('programming error') }, () => {})).toThrow('programming error')
})

test('committed workspace/request lease fences old A after A → B → A and unmount', async () => {
  const pending = deferred<string[]>(), events: unknown[] = []
  let workspace = 'a', generation = 1, mounted = true
  const lease = generation
  const running = readScopedCapability({ read: () => pending.promise,
    isCurrent: () => mounted && workspace === 'a' && generation === lease,
    onAvailable: value => events.push(value), onUnavailable: error => events.push(error) })
  workspace = 'b'; generation++
  workspace = 'a'; generation++
  pending.resolve(['obsolete-a'])
  await running
  expect(events).toEqual([])
  mounted = false; generation++
  await readScopedCapability({ read: async () => ['unmounted'], isCurrent: () => mounted && generation === lease,
    onAvailable: value => events.push(value), onUnavailable: error => events.push(error) })
  expect(events).toEqual([])
})

describe('Notes native transport presence is not document authority', () => {
  const actualShape = () => ({ nativeReplica: Object.fromEntries(
    ['open', 'close', 'enqueue', 'readSnapshot', 'pending', 'acknowledge'].map(name => [name, () => {}])),
    nativeData: { readEntity() {}, mutate() {} }, getTransportConnectionState() {} })
  test('web/missing/partial bridges cannot mount the Notes editor or start its native queue', () => {
    for (const api of [undefined, null, {}, { nativeReplica: {} },
      { ...actualShape(), nativeData: undefined }, { ...actualShape(), nativeReplica: { open() {} } }]) {
      let starts = 0, writes = 0
      if (hasNativeNotesTransport(api)) { starts++; writes++ }
      expect(hasNativeNotesTransport(api)).toBe(false)
      expect(starts).toBe(0)
      expect(writes).toBe(0)
    }
  })
  test('the full real interface is supported without executing operations or granting principal', () => {
    const api = actualShape()
    expect(hasNativeNotesTransport(api)).toBe(true)
    expect('nativePrincipal' in api).toBe(false)
  })
})

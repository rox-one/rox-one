import { expect, test } from 'bun:test'
import type { ElectronAPI } from '../../../../shared/types'
import { createDesktopSettingsSession } from '../desktop-settings-session'
import * as desktopSettings from '../desktop-settings-session'

const desktop = { getRuntimeEnvironment: () => 'electron' as const }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('web and partial bridges never read, save, or subscribe to desktop settings', async () => {
  for (const api of [{ getRuntimeEnvironment: () => 'web' as const }, {}, undefined]) {
    let calls = 0, published = 0, unavailable = 0
    const session = createDesktopSettingsSession<number>(api, () => { published++ }, () => { unavailable++ })
    expect(await session.run(() => { calls++; return 125 })).toBe(false)
    session.subscribe(() => { calls++; return () => {} }, () => { calls++ })
    expect({ calls, published, unavailable }).toEqual({ calls: 0, published: 0, unavailable: 2 })
    session.dispose()
  }
})

test('desktop read and save publish only the actual successful callback values', async () => {
  const values: unknown[] = [], errors: unknown[] = []
  const session = createDesktopSettingsSession<unknown>(desktop, value => values.push(value), error => errors.push(error))
  const readValue = { prefs: { cloudAsrConsent: false }, health: { whisper: 'ready' } }
  expect(await session.run(async () => readValue)).toBe(true)
  const save = deferred<unknown>()
  const pending = session.run(() => save.promise)
  await Promise.resolve()
  expect(values).toEqual([readValue])
  const savedValue = { prefs: { cloudAsrConsent: true }, health: { whisper: 'ready' } }
  save.resolve(savedValue)
  expect(await pending).toBe(true)
  expect(values).toEqual([readValue, savedValue])
  expect(errors).toEqual([])
  session.dispose()
})

test('sync missing methods and async transport refusals are observed without advancing saved state', async () => {
  const values: number[] = [], errors: unknown[] = []
  const session = createDesktopSettingsSession<number>(desktop, value => values.push(value), error => errors.push(error))
  expect(await session.run(() => 90)).toBe(true)
  const missing = new TypeError('Missing desktop method')
  expect(await session.run(() => { throw missing })).toBe(false)
  for (const code of ['LOCAL_ONLY_DENIED', 'CHANNEL_NOT_FOUND']) {
    const error = { code, message: 'Transport refused the operation' }
    expect(await session.run(async () => { throw error })).toBe(false)
    expect(errors.at(-1)).toBe(error)
  }
  expect(values).toEqual([90])
  expect(errors[0]).toBe(missing)
  session.dispose()
})

test('a newer reload or save supersedes both late successful and refused results', async () => {
  for (const refused of [false, true]) {
    const values: number[] = [], errors: unknown[] = []
    const session = createDesktopSettingsSession<number>(desktop, value => values.push(value), error => errors.push(error))
    const old = deferred<number>()
    const pending = session.run(() => old.promise)
    await Promise.resolve()
    expect(await session.run(() => 125)).toBe(true)
    if (refused) old.reject({ code: 'LOCAL_ONLY_DENIED' })
    else old.resolve(90)
    expect(await pending).toBe(false)
    expect(values).toEqual([125])
    expect(errors).toEqual([])
    session.dispose()
  }
})

test('disposal suppresses pending success, pending refusal, and calls not yet dispatched', async () => {
  for (const refused of [false, true]) {
    let callbacks = 0
    const session = createDesktopSettingsSession<number>(desktop, () => { callbacks++ }, () => { callbacks++ })
    const old = deferred<number>()
    const pending = session.run(() => old.promise)
    await Promise.resolve()
    session.dispose()
    if (refused) old.reject(new Error('Late refusal'))
    else old.resolve(125)
    expect(await pending).toBe(false)
    expect(callbacks).toBe(0)
  }
  let calls = 0
  const session = createDesktopSettingsSession<number>(desktop, () => {}, () => {})
  const pending = session.run(() => { calls++; return 125 })
  session.dispose()
  expect(await pending).toBe(false)
  expect(await session.run(() => { calls++; return 150 })).toBe(false)
  expect(calls).toBe(0)
})

test('runtime changes block later saves and prevent pending desktop values from becoming browser state', async () => {
  let runtime: 'electron' | 'web' = 'electron', writes = 0
  const values: number[] = [], errors: unknown[] = []
  const session = createDesktopSettingsSession<number>({ getRuntimeEnvironment: () => runtime }, value => values.push(value), error => errors.push(error))
  const old = deferred<number>()
  const pending = session.run(() => old.promise)
  await Promise.resolve()
  runtime = 'web'
  old.resolve(125)
  expect(await pending).toBe(false)
  expect(await session.run(() => { writes++; return 150 })).toBe(false)
  expect(writes).toBe(0)
  expect(values).toEqual([])
  expect(errors).toEqual([undefined, undefined])
  session.dispose()
})

test('runtime loss before queued dispatch prevents the host operation itself', async () => {
  let runtime: 'electron' | 'web' = 'electron', calls = 0, unavailable = 0
  const session = createDesktopSettingsSession<number>({ getRuntimeEnvironment: () => runtime }, () => {}, () => { unavailable++ })
  const pending = session.run(() => { calls++; return 125 })
  runtime = 'web'
  expect(await pending).toBe(false)
  expect(calls).toBe(0)
  expect(unavailable).toBe(1)
  session.dispose()
})

test('desktop subscriptions dispatch only live events and unsubscribe exactly once on disposal', () => {
  let event!: () => void, updates = 0, unsubscribed = 0
  const session = createDesktopSettingsSession<number>(desktop, () => {}, () => {})
  const cancel = session.subscribe(onChange => { event = onChange; return () => { unsubscribed++ } }, () => { updates++ })
  event()
  expect(updates).toBe(1)
  session.dispose()
  event()
  cancel()
  session.dispose()
  expect(updates).toBe(1)
  expect(unsubscribed).toBe(1)
})

test('synchronous subscription refusal is reported and a disposed session cannot register another listener', () => {
  const errors: unknown[] = []
  const session = createDesktopSettingsSession<number>(desktop, () => {}, error => errors.push(error))
  const actual = { code: 'CHANNEL_NOT_FOUND' }
  session.subscribe(() => { throw actual }, () => {})
  expect(errors).toEqual([actual])
  session.dispose()
  let registrations = 0
  session.subscribe(() => { registrations++; return () => {} }, () => {})
  expect(registrations).toBe(0)
})

test('renderer publication faults remain visible and are never reclassified as transport refusal', async () => {
  const actual = new Error('Renderer publication failed')
  let refused = 0
  const session = createDesktopSettingsSession<number>(desktop, () => { throw actual }, () => { refused++ })
  await expect(session.run(() => 125)).rejects.toBe(actual)
  expect(refused).toBe(0)
  session.dispose()
})

test('an unavailable callback fault remains visible without duplicate unavailable publication', async () => {
  const actual = new Error('Renderer unavailable publication failed')
  let callbacks = 0
  const session = createDesktopSettingsSession<number>({ getRuntimeEnvironment: () => 'web' }, () => {}, () => { callbacks++; throw actual })
  await expect(session.run(() => 125)).rejects.toBe(actual)
  expect(callbacks).toBe(1)
  session.dispose()
})

test('a refused or absent optional history preserves actual voice prefs and health with honest unavailable history', async () => {
  const prefs = { cloudAsrConsent: true } as any
  const health = { whisper: 'ready' } as any
  for (const list of [undefined, async () => { throw { code: 'CHANNEL_NOT_FOUND' } }]) {
    let prefsReads = 0, healthReads = 0
    const api = {
      getVoicePrefs: async () => { prefsReads++; return prefs },
      getVoiceHealth: async () => { healthReads++; return health },
      listVoiceHistory: list,
    }
    const values: unknown[] = []
    const session = createDesktopSettingsSession<unknown>(desktop, value => values.push(value), () => { throw new Error('Unexpected core refusal') })
    expect(await session.run(() => desktopSettings.readVoiceSettingsSnapshot(api))).toBe(true)
    expect(values).toEqual([{ prefs, health }])
    expect(await desktopSettings.readVoiceSettingsHistory(api)).toBe(null)
    expect(prefsReads).toBe(1)
    expect(healthReads).toBe(1)
    session.dispose()
  }
})

test('voice history publishes actual rows and treats malformed rows as unavailable without inventing empty success', async () => {
  const prefs = { cloudAsrConsent: true } as any, health = { whisper: 'ready' } as any
  const rows = [{ id: 'recording-actual', favorite: true, state: 'transcribed' }]
  const api = { getVoicePrefs: async () => prefs, getVoiceHealth: async () => health, listVoiceHistory: async () => ({ page: rows }) as any }
  expect(await desktopSettings.readVoiceSettingsSnapshot(api)).toEqual({ prefs, health })
  expect(await desktopSettings.readVoiceSettingsHistory(api)).toEqual(rows)
  api.listVoiceHistory = async () => ({ page: [{ id: 'recording-malformed', favorite: 'yes', state: 'transcribed' }] }) as any
  expect(await desktopSettings.readVoiceSettingsHistory(api)).toBe(null)
})

test('required voice read refusal is reported even when another getter throws synchronously', async () => {
  const refused = { code: 'LOCAL_ONLY_DENIED' }, errors: unknown[] = []
  const session = createDesktopSettingsSession<unknown>(desktop, () => { throw new Error('Unexpected fabricated voice state') }, error => errors.push(error))
  const api = { getVoicePrefs: async () => { throw refused }, getVoiceHealth: () => { throw new TypeError('Missing health method') } }
  expect(await session.run(() => desktopSettings.readVoiceSettingsSnapshot(api))).toBe(false)
  expect(errors).toHaveLength(1)
  session.dispose()
})

test('runtime getter errors are observed as capability refusal without dispatching any host callback', async () => {
  const actual = new Error('Runtime metadata missing'), errors: unknown[] = []
  let calls = 0
  const session = createDesktopSettingsSession<number>({ getRuntimeEnvironment: () => { throw actual } }, () => {}, error => errors.push(error))
  expect(await session.run(() => { calls++; return 125 })).toBe(false)
  session.subscribe(() => { calls++; return () => {} }, () => {})
  expect(calls).toBe(0)
  expect(errors).toEqual([actual, actual])
  session.dispose()
})

test('pending optional history cannot delay actual core prefs or a successful preference save', async () => {
  const prefs = { cloudAsrConsent: false } as any, health = { whisper: 'ready' } as any
  const pendingHistory = deferred<Awaited<ReturnType<ElectronAPI['listVoiceHistory']>>>()
  const api = { getVoicePrefs: async () => prefs, getVoiceHealth: async () => health, listVoiceHistory: () => pendingHistory.promise }
  const coreValues: unknown[] = [], historyValues: unknown[] = []
  const core = createDesktopSettingsSession<unknown>(desktop, value => coreValues.push(value), () => { throw new Error('Unexpected core refusal') })
  const history = createDesktopSettingsSession<unknown>(desktop, value => historyValues.push(value), () => { throw new Error('Unexpected history refusal') })
  const pending = history.run(() => desktopSettings.readVoiceSettingsHistory(api))
  expect(await core.run(() => desktopSettings.readVoiceSettingsSnapshot(api))).toBe(true)
  expect(coreValues).toEqual([{ prefs, health }])
  expect(historyValues).toEqual([])
  const actualSaved = { cloudAsrConsent: true }
  expect(await core.run(async () => ({ prefs: actualSaved, health }))).toBe(true)
  expect(coreValues.at(-1)).toEqual({ prefs: actualSaved, health })
  history.dispose()
  pendingHistory.resolve({ page: [], continueCursor: null, isDone: true })
  expect(await pending).toBe(false)
  expect(historyValues).toEqual([])
  core.dispose()
})

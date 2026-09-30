import { expect, test } from 'bun:test'
import { readLocalSessionCapability, loadCallerSessionInventory, type SessionCallerAuthority } from '../caller-session-loading'

test('native and unresolved callers never request host inventory on initial load, refresh or callback retry', async () => {
  for (const authority of ['native', null] as const) {
    let requests = 0, unavailable = 0
    const ports = { getAuthority: () => authority, request: async () => { requests++; throw Error('host inventory must not be called') },
      markUnavailable: () => { unavailable++ } }
    for (let attempt = 0; attempt < 3; attempt++) expect(await loadCallerSessionInventory(ports)).toEqual({ kind: 'unavailable' })
    expect(requests).toBe(0)
    expect(unavailable).toBe(3)
  }
})

test('local callers retain real inventory and actual denied/reconnect errors', async () => {
  const sessions = [{ id: 'existing-session', messages: ['actual-payload'] }]
  let requests = 0, unavailable = 0
  const ports = { getAuthority: () => 'local' as const, request: async () => { requests++; return sessions },
    markUnavailable: () => { unavailable++ } }
  expect(await loadCallerSessionInventory(ports)).toEqual({ kind: 'available', sessions })
  expect(requests).toBe(1)
  expect(unavailable).toBe(0)
  const denied = Error('actual authorization denial')
  await expect(loadCallerSessionInventory({ ...ports, request: async () => { throw denied } })).rejects.toBe(denied)
  expect(unavailable).toBe(0)
})

test('late local inventory and error cannot repopulate or display a host denial after native switch', async () => {
  for (const reject of [false, true]) {
    let authority: SessionCallerAuthority = 'local'
    let resolve!: (value: { id: string }[]) => void, fail!: (error: Error) => void
    const response = new Promise<{ id: string }[]>((done, denied) => { resolve = done; fail = denied })
    let requests = 0, unavailable = 0
    const pending = loadCallerSessionInventory({ getAuthority: () => authority, request: () => { requests++; return response },
      markUnavailable: () => { unavailable++ } })
    authority = 'native'
    if (reject) fail(Error('late host permission denial'))
    else resolve([{ id: 'private-host-session' }])
    expect(await pending).toEqual({ kind: 'unavailable' })
    expect(requests).toBe(1)
    expect(unavailable).toBe(1)
  }
})

test('delayed transport error recovery and permission reconciliation cannot apply after native switch', async () => {
  for (const payload of [{ connected: true }, { permissionMode: 'allow-all', modeVersion: 1 }]) {
    let authority: SessionCallerAuthority = 'local'
    let resolve!: (value: typeof payload) => void
    let applied = 0, requests = 0
    const response = new Promise<typeof payload>(done => { resolve = done })
    const pending = readLocalSessionCapability({ getAuthority: () => authority,
      request: () => { requests++; return response } }).then(result => {
      if (result.kind === 'available' && authority === 'local') applied++
      return result
    })
    authority = 'native'
    resolve(payload)
    expect(await pending).toEqual({ kind: 'unavailable' })
    expect(requests).toBe(1)
    expect(applied).toBe(0)
    expect(await readLocalSessionCapability({ getAuthority: () => authority, request: async () => { requests++; return payload } })).toEqual({ kind: 'unavailable' })
    expect(requests).toBe(1)
  }
})

test('local capability read preserves legacy payload and real errors', async () => {
  const value = { permissionMode: 'ask', modeVersion: 3 }
  expect(await readLocalSessionCapability({ getAuthority: () => 'local', request: async () => value })).toEqual({ kind: 'available', value })
  const error = Error('legacy read denied')
  await expect(readLocalSessionCapability({ getAuthority: () => 'local', request: async () => { throw error } })).rejects.toBe(error)
})

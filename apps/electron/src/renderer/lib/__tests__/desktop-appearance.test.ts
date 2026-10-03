import { expect, test } from 'bun:test'
import { readDesktopAppearance, saveDesktopAppearance } from '../desktop-appearance'

test('browser appearance never reads host preferences or pretends to have a native snapshot', async () => {
  let reads = 0, applied = 0, unavailable = 0
  readDesktopAppearance({ getRuntimeEnvironment: () => 'web' }, async () => { reads++; return { enabled: true } },
    () => { applied++ }, () => { unavailable++ })
  await Promise.resolve()
  expect({ reads, applied, unavailable }).toEqual({ reads: 0, applied: 0, unavailable: 1 })
})

test('a partial bridge without runtime metadata is unavailable and never executes host callbacks', async () => {
  let reads = 0, writes = 0, applied = 0, unavailable = 0
  const partial = {} as any
  readDesktopAppearance(partial, async () => { reads++; return 125 }, () => { applied++ }, () => { unavailable++ })
  expect(await saveDesktopAppearance(partial, async () => { writes++; return 125 }, () => { applied++ }, () => { unavailable++ })).toBe(false)
  expect({ reads, writes, applied, unavailable }).toEqual({ reads: 0, writes: 0, applied: 0, unavailable: 2 })
})

test('desktop denial and missing channel become unavailable, while a separate retry preserves actual values', async () => {
  for (const code of ['LOCAL_ONLY_DENIED', 'CHANNEL_NOT_FOUND']) {
    const actualError = { code, message: 'Real transport refusal' }
    let applied = 0
    const errors: unknown[] = []
    readDesktopAppearance({ getRuntimeEnvironment: () => 'electron' }, async () => { throw actualError },
      () => { applied++ }, error => { errors.push(error) })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(applied).toBe(0)
    expect(errors).toEqual([actualError])
  }
  const actual = { enabled: true, material: 'glass', preference: 'glass' }
  const values: unknown[] = []
  readDesktopAppearance({ getRuntimeEnvironment: () => 'electron' }, async () => actual, value => values.push(value),
    () => { throw new Error('Unexpected unavailable') })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(values).toEqual([actual])
})

test('cancelled appearance initialization ignores late success and refusal', async () => {
  for (const reject of [false, true]) {
    let release!: (value: number) => void, fail!: (error: unknown) => void
    let callbacks = 0
    const pending = new Promise<number>((resolve, reject) => { release = resolve; fail = reject })
    const cancel = readDesktopAppearance({ getRuntimeEnvironment: () => 'electron' }, () => pending,
      () => { callbacks++ }, () => { callbacks++ })
    await Promise.resolve()
    cancel()
    if (reject) fail({ code: 'CHANNEL_NOT_FOUND', message: 'Late refusal' })
    else release(125)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(callbacks).toBe(0)
  }
})

test('synchronous desktop read failures are observed as unavailable without unhandled promises', async () => {
  const error = new Error('Missing desktop bridge')
  const errors: unknown[] = []
  readDesktopAppearance({ getRuntimeEnvironment: () => 'electron' }, () => { throw error },
    () => { throw new Error('Unexpected value') }, value => { errors.push(value) })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(errors).toEqual([error])
})

test('browser and failed host persistence cannot advance the saved UI value', async () => {
  let writes = 0, displayed = 90
  const failures: unknown[] = []
  expect(await saveDesktopAppearance({ getRuntimeEnvironment: () => 'web' }, async () => { writes++; return 125 },
    value => { displayed = value }, error => failures.push(error))).toBe(false)
  expect({ writes, displayed }).toEqual({ writes: 0, displayed: 90 })
  const refused = { code: 'LOCAL_ONLY_DENIED', message: 'Persistence refused' }
  expect(await saveDesktopAppearance({ getRuntimeEnvironment: () => 'electron' }, async () => { writes++; throw refused },
    value => { displayed = value }, error => failures.push(error))).toBe(false)
  expect(displayed).toBe(90)
  expect(failures).toEqual([undefined, refused])
  expect(await saveDesktopAppearance({ getRuntimeEnvironment: () => 'electron' }, async () => { writes++; return 125 },
    value => { displayed = value }, error => failures.push(error))).toBe(true)
  expect(displayed).toBe(125)
})

test('a host write finishing after disposal cannot publish a saved UI value', async () => {
  let release!: (value: number) => void
  let cancelled = false, saved = 0
  const pending = saveDesktopAppearance({ getRuntimeEnvironment: () => 'electron' }, () => new Promise<number>(resolve => { release = resolve }),
    () => { saved++ }, () => { throw new Error('Unexpected failure') }, () => cancelled)
  cancelled = true
  release(125)
  expect(await pending).toBe(false)
  expect(saved).toBe(0)
})

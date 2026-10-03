import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { observeFirstNativeWindow } from './native-startup'

test('failed first-window callback retains bounded child diagnostics and joins cleanup before rejection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rox-ui001-native-startup-'))
  const profile = join(root, 'owned-profile')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(profile)
  const sentinel = join(root, 'unrelated')
  await writeFile(sentinel, 'retain')
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const originalError = new Error('firstWindow timed out')
  let closed = false
  const app = {
    process: () => ({ pid: 4123, stdout, stderr }),
    firstWindow: async () => {
      stdout.emit('data', Buffer.from('s'.repeat(40_000)))
      stderr.emit('data', Buffer.from('actual controlled startup failure'))
      throw originalError
    },
    close: async () => {
      expect(JSON.parse(await readFile(join(root, 'evidence/startup.json'), 'utf8')).stderr)
        .toBe('actual controlled startup failure')
      await new Promise(resolve => setImmediate(resolve))
      closed = true
    },
  } as unknown as ElectronApplication
  try {
    await expect(observeFirstNativeWindow(app, profile, join(root, 'evidence/startup.json')))
      .rejects.toBe(originalError)
    expect(closed).toBe(true)
    expect(await stat(profile).catch(() => null)).toBeNull()
    expect(await readFile(sentinel, 'utf8')).toBe('retain')
    const diagnostic = JSON.parse(await readFile(join(root, 'evidence/startup.json'), 'utf8'))
    expect(diagnostic.stdout.length).toBe(32 * 1024)
    expect(diagnostic.childPid).toBe(4123)
    expect(stdout.listenerCount('data')).toBe(0)
    expect(stderr.listenerCount('data')).toBe(0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a ready native window retains the caller-owned process and removes diagnostic listeners', async () => {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const page = {} as Page
  let closed = false
  const app = {
    process: () => ({ pid: 4124, stdout, stderr }),
    firstWindow: async () => page,
    close: async () => { closed = true },
  } as unknown as ElectronApplication
  expect(await observeFirstNativeWindow(app, 'unused-private-profile', 'unused-diagnostic')).toBe(page)
  expect(closed).toBe(false)
  expect(stdout.listenerCount('data')).toBe(0)
  expect(stderr.listenerCount('data')).toBe(0)
})

test('failed diagnostic persistence still closes the native child and preserves the first-window failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rox-ui001-native-diagnostic-'))
  const profile = join(root, 'owned-profile')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(profile)
  const originalError = new Error('controlled missing native window')
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  let closed = false
  const app = {
    process: () => ({ pid: 4125, stdout, stderr }),
    firstWindow: async () => { throw originalError },
    close: async () => { closed = true },
  } as unknown as ElectronApplication
  try {
    const failure = await observeFirstNativeWindow(app, profile, root).catch(error => error)
    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure.errors[0]).toBe(originalError)
    expect(failure.errors.length).toBe(2)
    expect(closed).toBe(true)
    expect(await stat(profile).catch(() => null)).toBeNull()
    expect(stdout.listenerCount('data')).toBe(0)
    expect(stderr.listenerCount('data')).toBe(0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

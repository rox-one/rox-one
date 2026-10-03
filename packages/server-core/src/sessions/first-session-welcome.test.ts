import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureFirstSessionWelcome } from './first-session-welcome'

const roots: string[] = []
async function markerPath() {
  const root = await mkdtemp(join(tmpdir(), 'first-session-'))
  roots.push(root)
  return join(root, 'first-session-welcome.v1.json')
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('first-session welcome persistence', () => {
  it('creates one conversation for concurrent windows and never repeats after restart or deletion', async () => {
    const path = await markerPath()
    let creations = 0
    const ports = {
      hasExistingSessions: () => false,
      createWelcome: async () => { creations += 1; return { id: 'welcome' } },
    }
    const results = await Promise.all([
      ensureFirstSessionWelcome(path, ports),
      ensureFirstSessionWelcome(path, ports),
    ])
    expect(creations).toBe(1)
    expect(results.filter(Boolean)).toEqual([{ id: 'welcome' }])
    expect(JSON.parse(await readFile(path, 'utf8')).sessionId).toBe('welcome')
    expect(await ensureFirstSessionWelcome(path, ports)).toBeNull()
    expect(creations).toBe(1)
  })

  it('does not add an onboarding conversation to an existing installation or on later workspace switches', async () => {
    const path = await markerPath()
    let creations = 0
    let existing = true
    const ports = {
      hasExistingSessions: () => existing,
      createWelcome: async () => { creations += 1; return { id: 'welcome' } },
    }
    expect(await ensureFirstSessionWelcome(path, ports)).toBeNull()
    existing = false
    expect(await ensureFirstSessionWelcome(path, ports)).toBeNull()
    expect(creations).toBe(0)
  })

  it('allows a retry after creation fails instead of recording success or retaining the lock', async () => {
    const path = await markerPath()
    await expect(ensureFirstSessionWelcome(path, {
      hasExistingSessions: () => false,
      createWelcome: async () => { throw new Error('storage unavailable') },
    })).rejects.toThrow('storage unavailable')
    expect(await ensureFirstSessionWelcome(path, {
      hasExistingSessions: () => false,
      createWelcome: async () => ({ id: 'retried' }),
    })).toEqual({ id: 'retried' })
  })
})

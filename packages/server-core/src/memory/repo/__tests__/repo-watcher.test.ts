import { describe, expect, it, spyOn } from 'bun:test'
import { createRepoWatcher, type RepoWatcherRepo } from '../repo-watcher'

interface FakeBankState {
  count: number
  fail?: boolean
}

function fakeRepo(banks: Record<string, FakeBankState>) {
  let listCalls = 0
  const statusCalls: string[] = []
  const repo: RepoWatcherRepo = {
    async listBanks() {
      listCalls++
      return Object.keys(banks).map((id) => ({ id }))
    },
    async status(bankId: string) {
      statusCalls.push(bankId)
      const state = banks[bankId]!
      if (state.fail) throw new Error('git status failed')
      return { dirty: state.count > 0, editedFiles: Array.from({ length: state.count }, (_, i) => `file-${i}.md`) }
    },
  }
  return {
    repo,
    get listCalls() { return listCalls },
    statusCalls,
  }
}

describe('createRepoWatcher', () => {
  it('does nothing when disabled', async () => {
    const banks = { 'ws:1': { count: 2 } }
    const fake = fakeRepo(banks)
    const changes: Array<[string, number]> = []
    const watcher = createRepoWatcher({
      repo: fake.repo,
      onChange: (bankId, count) => changes.push([bankId, count]),
      enabled: () => false,
    })
    await watcher.tick()
    await watcher.tick()
    expect(fake.listCalls).toBe(0)
    expect(changes).toEqual([])
  })

  it('defaults to disabled', async () => {
    const fake = fakeRepo({ 'ws:1': { count: 3 } })
    const watcher = createRepoWatcher({ repo: fake.repo, onChange: () => {} })
    await watcher.tick()
    expect(fake.listCalls).toBe(0)
  })

  it('emits once with the count when the tree diverges, then stays quiet', async () => {
    const banks = { 'ws:1': { count: 2 } }
    const fake = fakeRepo(banks)
    const changes: Array<[string, number]> = []
    const watcher = createRepoWatcher({
      repo: fake.repo,
      onChange: (bankId, count) => changes.push([bankId, count]),
      enabled: () => true,
    })
    await watcher.tick()
    expect(changes).toEqual([['ws:1', 2]])
    await watcher.tick()
    expect(changes).toEqual([['ws:1', 2]])
  })

  it('emits again only when the count changes', async () => {
    const banks = { 'ws:1': { count: 1 } }
    const fake = fakeRepo(banks)
    const changes: Array<[string, number]> = []
    const watcher = createRepoWatcher({
      repo: fake.repo,
      onChange: (bankId, count) => changes.push([bankId, count]),
      enabled: () => true,
    })
    await watcher.tick()
    banks['ws:1'].count = 3
    await watcher.tick()
    expect(changes).toEqual([['ws:1', 1], ['ws:1', 3]])
  })

  it('watches every bank and stays quiet for a clean tree', async () => {
    const banks = { 'ws:1': { count: 0 }, main: { count: 4 } }
    const fake = fakeRepo(banks)
    const changes: Array<[string, number]> = []
    const watcher = createRepoWatcher({
      repo: fake.repo,
      onChange: (bankId, count) => changes.push([bankId, count]),
      enabled: () => true,
    })
    await watcher.tick()
    expect(changes).toEqual([['main', 4]])
    expect(fake.statusCalls.sort()).toEqual(['main', 'ws:1'])
  })

  it('keeps polling after one bank fails', async () => {
    const banks = { 'ws:1': { count: 2, fail: true }, main: { count: 1 } }
    const fake = fakeRepo(banks)
    const changes: Array<[string, number]> = []
    const watcher = createRepoWatcher({
      repo: fake.repo,
      onChange: (bankId, count) => changes.push([bankId, count]),
      enabled: () => true,
    })
    await watcher.tick()
    expect(changes).toEqual([['main', 1]])
  })

  it('start installs exactly one interval, stop clears it, and both are idempotent', () => {
    const fake = fakeRepo({ 'ws:1': { count: 1 } })
    const token = { id: 'timer' } as unknown as NodeJS.Timeout
    const setSpy = spyOn(globalThis, 'setInterval').mockImplementation((() => token) as unknown as typeof setInterval)
    const clearSpy = spyOn(globalThis, 'clearInterval').mockImplementation((() => {}) as unknown as typeof clearInterval)
    try {
      const watcher = createRepoWatcher({ repo: fake.repo, onChange: () => {}, enabled: () => true, intervalMs: 1000 })

      watcher.start()
      expect(setSpy).toHaveBeenCalledTimes(1)
      expect(setSpy.mock.calls[0]?.[1]).toBe(1000)

      // a second start while running must not install a second interval
      watcher.start()
      expect(setSpy).toHaveBeenCalledTimes(1)

      watcher.stop()
      expect(clearSpy).toHaveBeenCalledTimes(1)
      expect(clearSpy).toHaveBeenCalledWith(token)

      // stop is idempotent: no second clear once the timer is gone
      watcher.stop()
      expect(clearSpy).toHaveBeenCalledTimes(1)

      // a restart after stop installs exactly one fresh interval, and stops again
      watcher.start()
      expect(setSpy).toHaveBeenCalledTimes(2)
      watcher.stop()
      expect(clearSpy).toHaveBeenCalledTimes(2)
    } finally {
      setSpy.mockRestore()
      clearSpy.mockRestore()
    }
  })
})
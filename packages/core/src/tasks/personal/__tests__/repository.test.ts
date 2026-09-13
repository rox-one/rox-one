import { describe, expect, it } from 'bun:test'
import { FileTaskRepository, TaskCorruptError, TaskQuotaError, TaskRevisionConflict } from '../repository.ts'
import { PersonalTaskStore, resetPersonalTaskIds } from '../store.ts'

function memoryFs(initial?: Record<string, string>) {
  const files = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    files,
    quota: false,
    async readFile(path: string) {
      const value = files.get(path)
      if (value == null) {
        const error = new Error('ENOENT') as Error & { code: string }
        error.code = 'ENOENT'
        throw error
      }
      return value
    },
    async writeFile(path: string, data: string) {
      if (this.quota) {
        const error = new Error('ENOSPC') as Error & { code: string }
        error.code = 'ENOSPC'
        throw error
      }
      files.set(path, data)
    },
    async mkdir() {},
    async rename(from: string, to: string) {
      const value = files.get(from)
      if (value == null) throw new Error('ENOENT')
      files.set(to, value)
      files.delete(from)
    },
  }
}

describe('FileTaskRepository (issue 332)', () => {
  it('round-trips tasks and restores ids after restart', async () => {
    resetPersonalTaskIds()
    const fs = memoryFs()
    const repo = new FileTaskRepository('/tmp/personal-tasks.json', fs)
    const store = new PersonalTaskStore()
    const created = store.create({ title: 'Keep', list: 'inbox', now: 1 })
    const saved = await repo.save(store, 0)
    expect(saved.sha256).toHaveLength(64)
    const reloaded = await repo.load()
    const again = reloaded.store.create({ title: 'Next', list: 'inbox', now: 2 })
    expect(again.id).not.toBe(created.id)
    expect(reloaded.store.list()[0]?.title).toBe('Keep')
  })

  it('rejects a stale expectedRevision from a second window', async () => {
    resetPersonalTaskIds()
    const fs = memoryFs()
    const repo = new FileTaskRepository('/tmp/personal-tasks.json', fs)
    const a = new PersonalTaskStore()
    a.create({ title: 'A', now: 1 })
    await repo.save(a, 0)
    const b = new PersonalTaskStore()
    b.create({ title: 'B', now: 2 })
    await expect(repo.save(b, 0)).rejects.toBeInstanceOf(TaskRevisionConflict)
  })

  it('preserves corrupt JSON in a backup and does not claim saved', async () => {
    const fs = memoryFs({ '/tmp/personal-tasks.json': '{not-json' })
    const repo = new FileTaskRepository('/tmp/personal-tasks.json', fs)
    await expect(repo.load()).rejects.toBeInstanceOf(TaskCorruptError)
    const backup = [...fs.files.keys()].find((path) => path.includes('.corrupt-'))
    expect(backup).toBeDefined()
    expect(fs.files.get(backup!)).toBe('{not-json')
  })

  it('does not report saved on quota errors', async () => {
    resetPersonalTaskIds()
    const fs = memoryFs()
    const repo = new FileTaskRepository('/tmp/personal-tasks.json', fs)
    const store = new PersonalTaskStore()
    store.create({ title: 'X', now: 1 })
    fs.quota = true
    await expect(repo.save(store, 0)).rejects.toBeInstanceOf(TaskQuotaError)
    expect(fs.files.has('/tmp/personal-tasks.json')).toBe(false)
  })

  it('migrates legacy JSON once and keeps a hash', async () => {
    resetPersonalTaskIds()
    const fs = memoryFs()
    const repo = new FileTaskRepository('/tmp/personal-tasks.json', fs)
    const legacy = new PersonalTaskStore()
    legacy.create({ title: 'Legacy', now: 1 })
    const migrated = await repo.migrateLegacyJson(legacy.exportJson())
    expect(migrated.migrated).toBe(true)
    expect(migrated.store.list()[0]?.title).toBe('Legacy')
    const second = await repo.migrateLegacyJson(legacy.exportJson())
    expect(second.migrated).toBe(false)
  })
})

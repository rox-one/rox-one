import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { PersonalTaskStore } from './store.ts'
import { emptyBundle, type PersonalTaskBundle } from './types.ts'

export const PERSONAL_TASKS_FILENAME = 'personal-tasks.json'
export const LEGACY_RENDERER_KEY = 'rox.personal-tasks.v1'

export class TaskRevisionConflict extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`Personal tasks CAS failed: expected ${expectedRevision}, actual ${actualRevision}`)
    this.name = 'TaskRevisionConflict'
  }
}

export class TaskQuotaError extends Error {
  constructor(message = 'Personal tasks write failed: storage quota exceeded') {
    super(message)
    this.name = 'TaskQuotaError'
  }
}

export class TaskCorruptError extends Error {
  constructor(readonly backupPath: string) {
    super(`Personal tasks JSON was corrupt; original preserved at ${backupPath}`)
    this.name = 'TaskCorruptError'
  }
}

export type TaskFs = {
  readFile(path: string): Promise<string>
  writeFile(path: string, data: string): Promise<void>
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
}

export type TaskLoadResult = {
  store: PersonalTaskStore
  revision: number
  sha256: string
  backupPath?: string
  migrated?: boolean
}

export type TaskSaveResult = {
  revision: number
  sha256: string
  json: string
}

const nodeFs: TaskFs = {
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, data) => writeFile(path, data, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  rename,
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function isQuota(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : ''
  const message = error instanceof Error ? error.message : String(error)
  return code === 'ENOSPC' || /quota/i.test(message)
}

export function personalTasksPath(configDir: string): string {
  return join(configDir, PERSONAL_TASKS_FILENAME)
}

export class FileTaskRepository {
  private lock: Promise<void> = Promise.resolve()

  constructor(
    private readonly filePath: string,
    private readonly fs: TaskFs = nodeFs,
  ) {}

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn)
    this.lock = run.then(() => undefined, () => undefined)
    return run
  }

  async load(): Promise<TaskLoadResult> {
    return this.withLock(() => this.loadUnlocked())
  }

  private async loadUnlocked(): Promise<TaskLoadResult> {
    try {
      const json = await this.fs.readFile(this.filePath)
      try {
        const store = PersonalTaskStore.fromJson(json)
        const revision = store.snapshot().revision ?? 0
        return { store, revision, sha256: sha256(json) }
      } catch {
        const backupPath = `${this.filePath}.corrupt-${Date.now()}`
        await this.fs.writeFile(backupPath, json)
        throw new TaskCorruptError(backupPath)
      }
    } catch (error) {
      if (error instanceof TaskCorruptError) throw error
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : ''
      if (code === 'ENOENT') {
        return { store: new PersonalTaskStore(), revision: 0, sha256: sha256('') }
      }
      throw error
    }
  }

  async save(store: PersonalTaskStore, expectedRevision: number): Promise<TaskSaveResult> {
    return this.withLock(() => this.saveUnlocked(store, expectedRevision))
  }

  private async saveUnlocked(store: PersonalTaskStore, expectedRevision: number): Promise<TaskSaveResult> {
      let currentRevision = 0
    try {
      const existing = await this.loadUnlocked()
      currentRevision = existing.revision
    } catch (error) {
      if (!(error instanceof TaskCorruptError)) throw error
    }
    if (expectedRevision !== currentRevision) {
      throw new TaskRevisionConflict(expectedRevision, currentRevision)
    }
    const bundle: PersonalTaskBundle = { ...store.snapshot(), revision: currentRevision + 1, version: 2 }
    const next = PersonalTaskStore.fromJson(JSON.stringify(bundle))
    const json = next.exportJson()
    try {
      await this.fs.mkdir(dirname(this.filePath))
      const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
      await this.fs.writeFile(tmp, json)
      await this.fs.rename(tmp, this.filePath)
    } catch (error) {
      if (isQuota(error)) throw new TaskQuotaError()
      throw error
    }
    return { revision: bundle.revision ?? currentRevision + 1, sha256: sha256(json), json }
  }

  async migrateLegacyJson(raw: string, expectedRevision = 0): Promise<TaskLoadResult> {
    return this.withLock(async () => {
      const incoming = PersonalTaskStore.fromJson(raw)
      const current = await this.loadUnlocked()
      if (current.revision !== 0 || current.store.list().length > 0) {
        return { ...current, migrated: false }
      }
      const merged = new PersonalTaskStore()
      merged.importBundle(incoming.snapshot(), 'replace')
      const saved = await this.saveUnlocked(merged, expectedRevision)
      return { store: PersonalTaskStore.fromJson(saved.json), revision: saved.revision, sha256: saved.sha256, migrated: true }
    })
  }
}

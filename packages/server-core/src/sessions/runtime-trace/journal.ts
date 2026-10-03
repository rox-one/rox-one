import { lstat, mkdir, open, readdir, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'

const NO_FOLLOW = constants.O_NOFOLLOW ?? 0
const READ_FLAGS = constants.O_RDONLY | NO_FOLLOW
const APPEND_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | NO_FOLLOW
const MAX_JOURNAL_BYTES = 256 * 1024 * 1024
export const MAX_RUNTIME_CONTENT_BYTES = 1024 * 1024
export const MAX_RUNTIME_RUN_CONTENT_BYTES = 256 * 1024 * 1024
export const MAX_RUNTIME_RUN_CONTENT_FILES = 8192

/** Portable session sidecar; no WorkGraph driver, database or execution authority. */
export class RuntimeTraceJournal<T extends { seq: number; eventId: string }> {
  private pending: Promise<void> = Promise.resolve()
  private initialized: Promise<T[]> | undefined
  private rows: T[] = []
  private bytes = 0
  private integrity: 'complete' | 'partial' = 'complete'

  private contentPending: Promise<void> = Promise.resolve()
  private contentInventory: Promise<void> | undefined
  private contentBytes = 0
  private contentFiles = new Set<string>()
  constructor(readonly directory: string, private readonly limits: { contentBytes?: number; contentFiles?: number } = {}) {}

  private loadContentInventory(): Promise<void> {
    return this.contentInventory ??= (async () => {
      for (const entry of await readdir(join(this.directory, 'content'), { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('Runtime content must not be a symlink')
        if (!entry.isFile()) continue
        const stat = await lstat(join(this.directory, 'content', entry.name))
        this.contentBytes += stat.size
        this.contentFiles.add(entry.name)
      }
      if (this.contentBytes > (this.limits.contentBytes ?? MAX_RUNTIME_RUN_CONTENT_BYTES) || this.contentFiles.size > (this.limits.contentFiles ?? MAX_RUNTIME_RUN_CONTENT_FILES)) throw new Error('Runtime trace run content exceeds quota')
    })()
  }

  private async prepare(): Promise<void> {
    // A user-editable session sidecar must not redirect writes/reads outside its session.
    for (const directory of [dirname(dirname(dirname(this.directory))), dirname(dirname(this.directory)), dirname(this.directory), this.directory, join(this.directory, 'content')]) {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      if ((await lstat(directory)).isSymbolicLink()) throw new Error('Runtime trace directory must not be a symlink')
    }
  }

  private load(): Promise<T[]> {
    if (this.initialized) return this.initialized
    const operation = (async () => {
      await this.prepare()
      let raw: string
      try {
        const path = join(this.directory, 'events.jsonl')
        if ((await lstat(path)).isSymbolicLink()) throw new Error('Runtime journal must not be a symlink')
        const file = await open(path, READ_FLAGS)
        try {
          if ((await file.stat()).size > MAX_JOURNAL_BYTES) throw new Error('Runtime trace journal exceeds size limit')
          raw = await file.readFile('utf8')
        } finally { await file.close() }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.rows
        throw error
      }
      this.bytes = Buffer.byteLength(raw)
      const completeEnd = raw.lastIndexOf('\n') + 1
      if (completeEnd !== raw.length) {
        // Recover only complete records after process interruption, never append onto a torn JSON line.
        this.integrity = 'partial'
        const recovered = await open(join(this.directory, 'events.jsonl'), constants.O_RDWR | NO_FOLLOW)
        try { await recovered.truncate(Buffer.byteLength(raw.slice(0, completeEnd))) } finally { await recovered.close() }
        raw = raw.slice(0, completeEnd)
        this.bytes = Buffer.byteLength(raw)
      }
      let previous = 0
      for (const line of raw.split('\n')) {
        if (!line) continue
        try {
          const row = JSON.parse(line) as T
          if (!Number.isSafeInteger(row.seq) || row.seq <= previous || typeof row.eventId !== 'string') throw new Error('Invalid trace sequence')
          previous = row.seq
          this.rows.push(row)
        } catch { this.integrity = 'partial' }
      }
      return this.rows
    })()
    this.initialized = operation.catch(error => { this.initialized = undefined; throw error })
    return this.initialized
  }

  async append(createRow: (seq: number) => T): Promise<T> {
    let result!: T
    const operation = this.pending.then(async () => {
      await this.load()
      result = createRow((this.rows.at(-1)?.seq ?? 0) + 1)
      const line = JSON.stringify(result) + '\n'
      const bytes = Buffer.byteLength(line)
      if (this.bytes + bytes > MAX_JOURNAL_BYTES) throw new Error('Runtime trace journal exceeds size limit')
      await this.prepare()
      const path = join(this.directory, 'events.jsonl')
      try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Runtime journal must not be a symlink') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const file = await open(path, APPEND_FLAGS, 0o600)
      try { await file.writeFile(line) } finally { await file.close() }
      this.bytes += bytes
      this.rows.push(result)
    })
    // A failed write remains visible to this caller, and does not poison future recovery.
    this.pending = operation.catch(() => {})
    await operation
    return result
  }

  async snapshot(after = 0, limit = 1000): Promise<{ rows: T[]; cursor: number; hasMore: boolean; integrity: 'complete' | 'partial' }> {
    await this.pending
    await this.load()
    const safeLimit = Math.max(1, Math.min(5000, Math.floor(limit)))
    const matching = this.rows.filter(row => row.seq > after)
    const rows = matching.slice(0, safeLimit)
    return { rows, cursor: rows.at(-1)?.seq ?? Math.min(after, this.rows.at(-1)?.seq ?? 0), hasMore: matching.length > rows.length, integrity: this.integrity }
  }

  async all(): Promise<{ rows: T[]; integrity: 'complete' | 'partial' }> { await this.pending; await this.load(); return { rows: [...this.rows], integrity: this.integrity } }

  async storeContent(sanitizedText: string): Promise<{ id: string; bytes: number; truncated: boolean }> {
    let result!: { id: string; bytes: number; truncated: boolean }
    const operation = this.contentPending.then(async () => {
      await this.load()
      await this.prepare()
      await this.loadContentInventory()
      const source = Buffer.from(sanitizedText)
      // Drop an incomplete final codepoint so the returned UTF-8 is always valid.
      const bounded = source.subarray(0, MAX_RUNTIME_CONTENT_BYTES).toString('utf8').replace(/\uFFFD$/, '')
      const bytes = Buffer.byteLength(bounded)
      const id = createHash('sha256').update(bounded).digest('hex')
      const name = `${id}.txt`
      const path = join(this.directory, 'content', name)
      if (!this.contentFiles.has(name)) {
        if (this.contentBytes + bytes > (this.limits.contentBytes ?? MAX_RUNTIME_RUN_CONTENT_BYTES) || this.contentFiles.size + 1 > (this.limits.contentFiles ?? MAX_RUNTIME_RUN_CONTENT_FILES)) throw new Error('Runtime trace run content exceeds quota')
        await this.prepare()
        try {
          await writeFile(path, bounded, { flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW, mode: 0o600 })
          this.contentBytes += bytes
          this.contentFiles.add(name)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
          const stat = await lstat(path)
          if (stat.isSymbolicLink()) throw new Error('Runtime content must not be a symlink')
          this.contentBytes += stat.size
          this.contentFiles.add(name)
          if (this.contentBytes > (this.limits.contentBytes ?? MAX_RUNTIME_RUN_CONTENT_BYTES)) throw new Error('Runtime trace run content exceeds quota')
        }
      } else if ((await lstat(path)).isSymbolicLink()) throw new Error('Runtime content must not be a symlink')
      result = { id, bytes, truncated: source.length > MAX_RUNTIME_CONTENT_BYTES }
    })
    this.contentPending = operation.catch(() => {})
    await operation
    return result
  }

  async readContent(id: string): Promise<string | null> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid runtime content id')
    await this.load()
    await this.prepare()
    const path = join(this.directory, 'content', `${id}.txt`)
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new Error('Runtime content must not be a symlink')
      const file = await open(path, READ_FLAGS)
      try {
        if ((await file.stat()).size > MAX_RUNTIME_CONTENT_BYTES) throw new Error('Runtime content exceeds size limit')
        const content = await file.readFile('utf8')
        if (createHash('sha256').update(content).digest('hex') !== id) throw new Error('Runtime content integrity mismatch')
        return content
      } finally { await file.close() }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
}

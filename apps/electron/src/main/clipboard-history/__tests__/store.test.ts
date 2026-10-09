import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import {
  ClipEntryRejectedError,
  ClipboardHistorySchemaError,
  ClipboardHistoryStore,
  ClipboardHistoryUnavailableError,
  MAX_TAG_COUNT,
  MAX_TEXT_BYTES,
  normalizeTags,
} from '../store'

let dir: string
let clock: number
const now = (): Date => new Date(clock)

function makeStore(): ClipboardHistoryStore {
  return new ClipboardHistoryStore({ dir, now })
}

function imageFilePath(format: string, bytes: Buffer): string {
  const hash = createHash('sha256').update(Buffer.concat([Buffer.from('image\u0000'), bytes])).digest('hex')
  return join(dir, 'images', `${hash}.${format}`)
}

const IMAGE_BYTES = Buffer.from('fake-png-bytes-0123456789')
const THUMB_BYTES = Buffer.from('thumb')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clip-store-'))
  clock = Date.parse('2026-10-09T10:00:00.000Z')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('ClipboardHistoryStore', () => {
  it('dedupes by content hash and resurfaces the existing row', () => {
    const store = makeStore()
    const first = store.insertOrResurface({ kind: 'text', text: 'hello' })
    expect(first.inserted).toBe(true)
    clock += 60_000
    const other = store.insertOrResurface({ kind: 'text', text: 'other' })
    expect(other.inserted).toBe(true)
    clock += 60_000
    const again = store.insertOrResurface({ kind: 'text', text: 'hello' })
    expect(again).toEqual({ id: first.id, inserted: false })
    const listed = store.list()
    expect(listed.entries).toHaveLength(2)
    expect(listed.entries[0].id).toBe(first.id)
    expect(listed.entries[0].text).toBe('hello')
    store.close()
  })

  it('searches, filters, and paginates', () => {
    const store = makeStore()
    store.insertOrResurface({ kind: 'text', text: 'Alpha note' })
    clock += 1_000
    const beta = store.insertOrResurface({ kind: 'text', text: 'beta ALPHA' })
    clock += 1_000
    store.insertOrResurface({ kind: 'text', text: 'gamma' })
    clock += 1_000
    store.insertOrResurface({
      kind: 'image',
      imageBytes: IMAGE_BYTES,
      imageFormat: 'png',
      imageWidth: 100,
      imageHeight: 50,
      thumbnailPng: THUMB_BYTES,
    })
    store.setStarred(beta.id, true)
    store.setTags(beta.id, ['work'])

    const all = store.list()
    expect(all.total).toBe(4)
    expect(all.counts).toEqual({ total: 4, starred: 1, text: 3, image: 1 })
    expect(all.entries[0].kind).toBe('image')
    expect(all.entries[0].thumbDataUrl).toBe(`data:image/png;base64,${THUMB_BYTES.toString('base64')}`)
    expect(all.entries[0].imageWidth).toBe(100)

    expect(store.list({ q: 'alpha' }).total).toBe(2)
    expect(store.list({ q: 'ALPHA' }).total).toBe(2)
    expect(store.list({ q: '%' }).total).toBe(0)
    expect(store.list({ kind: 'image' }).total).toBe(1)
    expect(store.list({ kind: 'text' }).total).toBe(3)
    expect(store.list({ starredOnly: true }).entries[0].id).toBe(beta.id)
    expect(store.list({ tag: 'WORK' }).total).toBe(1)

    const page = store.list({ limit: 2 })
    expect(page.entries).toHaveLength(2)
    expect(page.hasMore).toBe(true)
    const last = store.list({ limit: 2, offset: 2 })
    expect(last.entries).toHaveLength(2)
    expect(last.hasMore).toBe(false)
    store.close()
  })

  it('filters listed entries by image format', () => {
    const store = makeStore()
    store.insertOrResurface({ kind: 'text', text: 'plain text' })
    clock += 1_000
    const png = store.insertOrResurface({ kind: 'image', imageBytes: IMAGE_BYTES, imageFormat: 'png' })
    clock += 1_000
    const gif = store.insertOrResurface({ kind: 'image', imageBytes: Buffer.from('a-gif-image'), imageFormat: 'gif' })

    const pngOnly = store.list({ format: 'png' })
    expect(pngOnly.entries.map(entry => entry.id)).toEqual([png.id])
    expect(pngOnly.total).toBe(1)
    expect(pngOnly.entries.every(entry => entry.kind === 'image' && entry.imageFormat === 'png')).toBe(true)

    const gifOnly = store.list({ format: 'gif' })
    expect(gifOnly.entries.map(entry => entry.id)).toEqual([gif.id])
    expect(gifOnly.total).toBe(1)
    expect(store.list({ format: 'jpg' }).total).toBe(0)

    // 'all' and an omitted format keep the unfiltered result set unchanged.
    expect(store.list({ format: 'all' }).total).toBe(store.list().total)
    expect(store.list({ format: 'all' }).total).toBe(3)
    // Counts stay global regardless of the active format filter.
    expect(pngOnly.counts).toEqual({ total: 3, starred: 0, text: 1, image: 2 })
    store.close()
  })

  it('writes and removes image files on delete and clear', () => {
    const store = makeStore()
    const image = store.insertOrResurface({ kind: 'image', imageBytes: IMAGE_BYTES, imageFormat: 'png' })
    const filePath = imageFilePath('png', IMAGE_BYTES)
    expect(existsSync(filePath)).toBe(true)
    const detail = store.get(image.id)
    expect(detail?.imageDataUrl?.startsWith('data:image/png;base64,')).toBe(true)

    store.delete(image.id)
    expect(store.get(image.id)).toBeNull()
    expect(existsSync(filePath)).toBe(false)

    const second = store.insertOrResurface({ kind: 'image', imageBytes: Buffer.from('another-image'), imageFormat: 'jpg' })
    store.setStarred(second.id, true)
    const third = store.insertOrResurface({ kind: 'image', imageBytes: Buffer.from('third-image'), imageFormat: 'png' })
    const thirdPath = imageFilePath('png', Buffer.from('third-image'))
    expect(existsSync(thirdPath)).toBe(true)
    const removed = store.clear(true)
    expect(removed).toBe(1)
    expect(store.get(second.id)).not.toBeNull()
    expect(store.get(third.id)).toBeNull()
    expect(existsSync(thirdPath)).toBe(false)
    expect(store.list({ kind: 'image' }).total).toBe(1)
    store.close()
  })

  it('keeps starred rows through pruning and expires by retention', () => {
    const store = makeStore()
    const old = store.insertOrResurface({ kind: 'text', text: 'old unstarred' })
    clock += 1_000
    const starred = store.insertOrResurface({ kind: 'text', text: 'old starred' })
    store.setStarred(starred.id, true)
    clock += 60 * 86_400_000
    const fresh = store.insertOrResurface({ kind: 'text', text: 'fresh' })
    const result = store.prune(new Date(clock))
    expect(result.expired).toBe(1)
    expect(store.get(old.id)).toBeNull()
    expect(store.get(starred.id)).not.toBeNull()
    expect(store.get(fresh.id)).not.toBeNull()
    store.close()
  })

  it('trims non-starred rows beyond maxEntries', () => {
    const store = makeStore()
    store.saveSettings({ maxEntries: 100 })
    const ids: number[] = []
    for (let index = 0; index < 105; index += 1) {
      clock += 1_000
      ids.push(store.insertOrResurface({ kind: 'text', text: `entry-${index}` }).id)
    }
    store.setStarred(ids[0], true)
    const result = store.prune(new Date(clock))
    expect(result.trimmed).toBe(4)
    expect(store.get(ids[0])).not.toBeNull()
    expect(store.list().total).toBe(101)
    store.close()
  })

  it('normalizes tags and hides internal tag vocabulary', () => {
    const store = makeStore()
    const entry = store.insertOrResurface({ kind: 'text', text: 'tagged' })
    store.setTags(entry.id, ['  Work ', 'work', 'URGENT', '', 'secret-token', 'code', 'token'])
    expect(store.get(entry.id)?.tags).toEqual(['code', 'secret-token', 'token', 'urgent', 'work'])
    const counts = store.tagCounts()
    expect(counts.map(row => row.tag)).toEqual(['secret-token', 'urgent', 'work'])
    expect(normalizeTags(Array.from({ length: 12 }, (_value, index) => `t${index}`))).toHaveLength(MAX_TAG_COUNT)
    expect(normalizeTags(['x'.repeat(80)])[0]).toHaveLength(32)
    store.close()
  })

  it('validates settings and persists normalized values', () => {
    const store = makeStore()
    expect(store.getSettings()).toEqual({
      captureEnabled: true,
      captureImages: true,
      retentionDays: 30,
      maxEntries: 2000,
      hideSensitive: true,
      globalShortcutEnabled: false,
      globalShortcut: 'CommandOrControl+Shift+V',
    })
    const saved = store.saveSettings({ retentionDays: 5, maxEntries: 50, captureEnabled: false, globalShortcut: '   ' })
    expect(saved.retentionDays).toBe(30)
    expect(saved.maxEntries).toBe(100)
    expect(saved.captureEnabled).toBe(false)
    expect(saved.globalShortcut).toBe('CommandOrControl+Shift+V')
    store.close()

    const reopened = makeStore()
    expect(reopened.getSettings()).toEqual(saved)
    reopened.close()
  })

  it('reports stats over content and image storage', () => {
    const store = makeStore()
    store.insertOrResurface({ kind: 'text', text: 'hello' })
    clock += 1_000
    store.insertOrResurface({ kind: 'image', imageBytes: IMAGE_BYTES, imageFormat: 'png' })
    const stats = store.stats()
    expect(stats.total).toBe(2)
    expect(stats.text).toBe(1)
    expect(stats.image).toBe(1)
    expect(stats.bytes).toBe(5 + IMAGE_BYTES.length)
    expect(stats.storageBytes).toBe(IMAGE_BYTES.length)
    expect(stats.oldestAt).toBe('2026-10-09T10:00:00.000Z')
    store.close()
  })

  it('rejects oversized and malformed payloads', () => {
    const store = makeStore()
    expect(() => store.insertOrResurface({ kind: 'text', text: '' })).toThrow(ClipEntryRejectedError)
    expect(() => store.insertOrResurface({ kind: 'text', text: 'x'.repeat(MAX_TEXT_BYTES + 1) })).toThrow(ClipEntryRejectedError)
    expect(() => store.insertOrResurface({ kind: 'image', imageBytes: Buffer.alloc(0), imageFormat: 'png' })).toThrow(ClipEntryRejectedError)
    expect(() => store.insertOrResurface({ kind: 'image', imageBytes: IMAGE_BYTES })).toThrow(ClipEntryRejectedError)
    store.close()
  })

  it('refuses an unknown schema version and reopens cleanly otherwise', () => {
    const store = makeStore()
    store.insertOrResurface({ kind: 'text', text: 'persisted' })
    store.close()

    const reopened = makeStore()
    expect(reopened.list().total).toBe(1)
    reopened.close()

    const raw = new DatabaseSync(join(dir, 'history.db'))
    raw.exec('PRAGMA user_version=99')
    raw.close()
    expect(() => new ClipboardHistoryStore({ dir, now })).toThrow(ClipboardHistorySchemaError)
  })

  it('throws a typed error for a corrupt database file', () => {
    rmSync(join(dir, 'history.db'), { force: true })
    writeFileSync(join(dir, 'history.db'), Buffer.from('not a sqlite database at all'))
    expect(() => new ClipboardHistoryStore({ dir, now })).toThrow()
  })

  it('clamps an oversized search query and still returns sane results', () => {
    const store = makeStore()
    store.insertOrResurface({ kind: 'text', text: 'hello world' })
    const huge = 'z'.repeat(1_048_576)
    expect(() => store.list({ q: huge })).not.toThrow()
    expect(store.list({ q: huge }).total).toBe(0)
    // The tail beyond 256 characters is dropped, so a real match after it is not found.
    expect(store.list({ q: `${'z'.repeat(256)}hello` }).total).toBe(0)
    expect(store.list({ q: 'hello' }).total).toBe(1)
    store.close()
  })

  it('unlinks a freshly written image file when the row insert fails', () => {
    const store = makeStore()
    store.close()
    const raw = new DatabaseSync(join(dir, 'history.db'))
    raw.exec("CREATE TRIGGER clip_fail_insert BEFORE INSERT ON clip_entries BEGIN SELECT RAISE(ABORT, 'forced'); END;")
    raw.close()
    const reopened = makeStore()
    const filePath = imageFilePath('png', IMAGE_BYTES)
    expect(() => reopened.insertOrResurface({ kind: 'image', imageBytes: IMAGE_BYTES, imageFormat: 'png' })).toThrow()
    expect(existsSync(filePath)).toBe(false)
    reopened.close()
  })

  it('enables secure_delete on the connection', () => {
    const store = makeStore()
    // secure_delete is a per-connection pragma, so it must be read from the store's own
    // private connection; this structural read is only how the test reaches it.
    const internals = store as unknown as { db: { prepare(sql: string): { get(): unknown } } }
    const result = internals.db.prepare('PRAGMA secure_delete').get()
    const value = typeof result === 'number' ? result : (result as { secure_delete?: number } | undefined)?.secure_delete
    expect(Number(value)).toBe(1)
    store.close()
  })

  it('throws a typed unavailable error when storage cannot be opened', () => {
    const filePath = join(dir, 'not-a-directory')
    writeFileSync(filePath, 'blocking file')
    expect(() => new ClipboardHistoryStore({ dir: filePath, now })).toThrow(ClipboardHistoryUnavailableError)
  })

  it('accepts exactly 1 MiB of text and rejects one byte more', () => {
    const store = makeStore()
    const exact = 'x'.repeat(MAX_TEXT_BYTES)
    expect(Buffer.byteLength(exact, 'utf8')).toBe(MAX_TEXT_BYTES)
    expect(store.insertOrResurface({ kind: 'text', text: exact }).inserted).toBe(true)
    expect(() => store.insertOrResurface({ kind: 'text', text: `${exact}y` })).toThrow(ClipEntryRejectedError)
    store.close()
  })

  it('creates the store directory, database, and image files with private modes', () => {
    const store = makeStore()
    store.insertOrResurface({ kind: 'text', text: 'private' })
    const image = store.insertOrResurface({ kind: 'image', imageBytes: IMAGE_BYTES, imageFormat: 'png' })
    expect(image.inserted).toBe(true)
    // POSIX permission bits are meaningless on Windows, so the mode assertions are skipped there.
    if (process.platform !== 'win32') {
      expect(statSync(store.dir).mode & 0o777).toBe(0o700)
      expect(statSync(store.databasePath).mode & 0o777).toBe(0o600)
      expect(statSync(imageFilePath('png', IMAGE_BYTES)).mode & 0o777).toBe(0o600)
    }
    store.close()
  })
})
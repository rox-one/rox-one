/**
 * WP §13 «нет параллельной памяти» — architectural guard.
 *
 * The repo layer (`packages/server-core/src/memory/repo/*.ts`) is a *projection*:
 * it reads the existing stores (LessonStore, MemoryFileStore) and renders files,
 * but it must never write the source of truth itself. All mutations go through
 * the existing services / proposal approval path.
 *
 * This test scans the module sources (readFileSync) and fails if any of them
 * calls a source-of-truth write method. It also asserts the scan saw the
 * expected module files, so it can never silently pass over an empty set.
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MODULE_DIR = join(import.meta.dir, '..')

/** Concrete module files the guard must see (a silently empty scan must fail). */
const EXPECTED_MODULES = [
  'MemoryRepoService.ts',
  'MemoryRepoMaterializer.ts',
  'DreamCostTracker.ts',
  'DreamNotesScanner.ts',
  'DreamRunner.ts',
  'DreamScheduler.ts',
  'RepoSourceProvider.ts',
  'notify.ts',
  'repo-import-parser.ts',
  'repo-watcher.ts',
  'snapshots.ts',
]

/**
 * Store write methods that are unambiguous (they exist only on the source of
 * truth) — forbidden on any receiver.
 */
const ALWAYS_FORBIDDEN: readonly string[] = [
  'replaceForOwner',
  'writeContext',
  'writePreferences',
  'appendDailyHistory',
  'touchUsed',
  'recordConflict',
  'restoreArchivedForOwner',
]

/**
 * Ambiguous names shared with plain collections (`Set.add`, `Map.delete`,
 * `createHash(...).update`). They are forbidden only on a store-typed receiver
 * (the projection layer's `store`/`lessonStore`/`files` variables).
 */
const STORE_WRITE_METHODS: readonly string[] = ['add', 'update', 'delete']

const CALL_RE = /([A-Za-z_$][A-Za-z0-9_$.]*)\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g
const STORE_RECEIVER_RE = /(store|stores|files)$/i

/** Forbidden calls in one module source, as `file: receiver.method(` strings. */
function violations(file: string, source: string): string[] {
  const found: string[] = []
  // Comments are dropped so a doc block mentioning a forbidden call is not a hit.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  for (const match of code.matchAll(CALL_RE)) {
    const receiver = match[1]!
    const method = match[2]!
    if (ALWAYS_FORBIDDEN.includes(method)) {
      found.push(`${file}: ${receiver}.${method}(`)
    } else if (STORE_WRITE_METHODS.includes(method) && STORE_RECEIVER_RE.test(receiver)) {
      found.push(`${file}: ${receiver}.${method}(`)
    }
  }
  return found
}

describe('memory repo projection layer never writes the source of truth', () => {
  const modules = readdirSync(MODULE_DIR).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))

  it('scans every expected module file (never an empty set)', () => {
    for (const expected of EXPECTED_MODULES) expect(modules).toContain(expected)
    expect(modules.length).toBeGreaterThanOrEqual(EXPECTED_MODULES.length)
  })

  it('no repo module calls a LessonStore/MemoryFileStore write method', () => {
    const found: string[] = []
    for (const file of modules) found.push(...violations(file, readFileSync(join(MODULE_DIR, file), 'utf8')))
    expect(found).toEqual([])
  })

  it('detects a forbidden call (scanner self-check)', () => {
    expect(violations('x.ts', 'lessonStore.add({ rule: "x" }, "user")')).toEqual(['x.ts: lessonStore.add('])
    expect(violations('x.ts', 'files.writeContext("c")')).toEqual(['x.ts: files.writeContext('])
    // Telemetry/feedback/archive writes are source-of-truth mutations too.
    expect(violations('x.ts', 'lessonStore.touchUsed([id], owner)')).toEqual(['x.ts: lessonStore.touchUsed('])
    expect(violations('x.ts', 'lessonStore.recordConflict(rule, evt)')).toEqual(['x.ts: lessonStore.recordConflict('])
    expect(violations('x.ts', 'lessonStore.restoreArchivedForOwner(owner, archiveId)')).toEqual(['x.ts: lessonStore.restoreArchivedForOwner('])
    // plain collections and hashing are not violations
    expect(violations('x.ts', 'this.listeners.add(fn)\nseen.add(id)\ncreateHash("sha1").update(text)')).toEqual([])
  })
})
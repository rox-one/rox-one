/**
 * Index P0 foreign roots. Writes a scan cache only — never creates Rox sessions.
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import {
  convertForeignSource,
  inspectForeignSource,
  listChatExportConversations,
  MAX_FOREIGN_EXPORT_BYTES,
  redactSecrets,
} from './import-convert.ts'
import { isSensitiveAgentCwd, splitForeignSourceRef } from './import-home.ts'
import { foreignImportScanCachePath, loadForeignImportScanCacheFile } from './import-registry.ts'
import type { ForeignDiscoverResult, ForeignIndexEntry, ForeignSessionKind } from './import-types.ts'
import { isInternalAgentPrompt } from './internal-prompts.ts'

export const MAX_SCAN_ENTRIES = 100_000
export const MAX_SCAN_PER_KIND = 20_000

export interface DiscoverForeignOptions {
  workspaceRoot: string
  homeDir?: string
  writeCache?: boolean
  now?: number
  maxEntries?: number
  maxPerKind?: number
  /** Reuse unchanged entries from the previous scan cache (incremental rescans). */
  reuseCache?: boolean
  /** Rechecked before each source metadata/content read so consent revocation stops the scan. */
  shouldContinue?: () => boolean
}

function listDirs(path: string, shouldContinue: () => boolean): string[] {
  if (!shouldContinue() || !existsSync(path)) return []
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => shouldContinue() && entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.'))
      .map((entry) => join(path, entry.name))
  } catch {
    return []
  }
}

function listFiles(path: string, suffix: string, shouldContinue: () => boolean): string[] {
  if (!shouldContinue() || !existsSync(path)) return []
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => shouldContinue() && entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(suffix))
      .map((entry) => join(path, entry.name))
      .filter((file) => {
        if (!shouldContinue()) return false
        const maxBytes = file.endsWith('.json') && !file.endsWith('.jsonl') ? MAX_FOREIGN_EXPORT_BYTES : undefined
        return inspectForeignSource(file, maxBytes).status === 'ok'
      })
  } catch {
    return []
  }
}

function walkFiles(root: string, suffix: string, maxDepth: number, halted: () => boolean, depth = 0): string[] {
  if (halted() || depth > maxDepth || !existsSync(root)) return []
  try {
    if (lstatSync(root).isSymbolicLink()) return []
  } catch {
    return []
  }
  const files = listFiles(root, suffix, () => !halted())
  if (depth === maxDepth) return files
  for (const dir of listDirs(root, () => !halted())) {
    if (halted()) break
    files.push(...walkFiles(dir, suffix, maxDepth, halted, depth + 1))
  }
  return files
}

function mtimeMs(path: string): number | undefined {
  try {
    return lstatSync(splitForeignSourceRef(path).path).mtimeMs
  } catch {
    return undefined
  }
}

const SKIP_BASENAMES = new Set([
  'settings.json',
  'config.json',
  'config.yml',
  'config.yaml',
  'package.json',
  'sessions.json',
  'ledger.jsonl',
])

function shouldSkipFile(file: string): boolean {
  return SKIP_BASENAMES.has(basename(file))
}

type EntryFor = (kind: ForeignSessionKind, sourcePath: string) => ForeignIndexEntry

function* expandChatSources(
  kind: ForeignSessionKind,
  file: string,
  consider: (entry: ForeignIndexEntry) => boolean,
  entryFor: EntryFor,
): Generator<void, boolean> {
  if (shouldSkipFile(file)) return true
  if (basename(file) === 'conversations.json') {
    const listed = listChatExportConversations(file)
    if (listed.length > 1) {
      for (const conv of listed) {
        const sourcePath = `${file}#${conv.id}`
        if (!consider(toEntry(kind, sourcePath, convertForeignSource(sourcePath, kind)))) return false
        yield
      }
      return true
    }
  }
  const ok = consider(entryFor(kind, file))
  yield
  return ok
}

function* scanKindFiles(
  kind: ForeignSessionKind,
  roots: string[],
  suffixes: string[],
  depth: number,
  consider: (entry: ForeignIndexEntry) => boolean,
  halted: () => boolean,
  entryFor: EntryFor,
  filter?: (file: string) => boolean,
): Generator<void, void> {
  if (halted()) return
  for (const root of roots) {
    for (const suffix of suffixes) {
      for (const file of walkFiles(root, suffix, depth, halted)) {
        if (halted()) return
        if (shouldSkipFile(file)) continue
        if (filter && !filter(file)) continue
        if (!(yield* expandChatSources(kind, file, consider, entryFor))) return
      }
    }
  }
}

export function filterForeignIndexEntries(
  entries: ForeignIndexEntry[],
  options: { query?: string; kind?: ForeignSessionKind | 'all' },
): ForeignIndexEntry[] {
  const query = options.query?.trim().toLowerCase() ?? ''
  const kind = options.kind && options.kind !== 'all' ? options.kind : null
  return entries.filter((entry) => {
    if (kind && entry.kind !== kind) return false
    if (!query) return true
    const haystack = `${entry.title ?? ''} ${entry.sourcePath} ${entry.kind}`.toLowerCase()
    return haystack.includes(query)
  })
}

function toEntry(
  kind: ForeignSessionKind,
  sourcePath: string,
  converted: ReturnType<typeof convertForeignSource>,
): ForeignIndexEntry {
  const title = converted.title ? redactSecrets(converted.title).text : converted.title
  const cwdHit = converted.cwd ? redactSecrets(converted.cwd) : undefined
  const cwd = cwdHit?.text && !isSensitiveAgentCwd(cwdHit.text) ? cwdHit.text : undefined
  return {
    id: `${kind}:${sourcePath}`,
    kind,
    sourcePath,
    title,
    cwd,
    userTurns: converted.userTurns,
    mtimeMs: mtimeMs(sourcePath),
    skipReason: converted.userTurns === 0
      ? 'empty'
      : isInternalAgentPrompt(converted.messages.find((m) => m.role === 'user')?.content)
        ? 'internal'
        : undefined,
  }
}

function* discoverForeignSessionsIter(options: DiscoverForeignOptions): Generator<void, ForeignDiscoverResult> {
  const home = options.homeDir ?? homedir()
  const entries: ForeignIndexEntry[] = []
  const counts: Partial<Record<ForeignSessionKind, number>> = {}
  const maxEntries = options.maxEntries ?? MAX_SCAN_ENTRIES
  const maxPerKind = options.maxPerKind ?? MAX_SCAN_PER_KIND
  let truncated = false
  let halt = false
  const shouldContinue = options.shouldContinue ?? (() => true)
  const halted = () => halt || !shouldContinue()

  // Incremental rescans: reuse the previous scan's entry for any source whose
  // mtime has not changed, so only new or modified chats are re-parsed.
  const reuse = new Map<string, ForeignIndexEntry>()
  const emptyPrev = new Map<string, number>()
  const emptyNext: Record<string, number> = {}
  if (options.reuseCache) {
    const prev = loadForeignImportScanCacheFile(options.workspaceRoot)
    for (const entry of prev.entries) reuse.set(entry.sourcePath, entry)
    for (const [path, mtime] of Object.entries(prev.empties)) emptyPrev.set(path, mtime)
  }
  const entryFor: EntryFor = (kind, sourcePath) => {
    if (!shouldContinue()) return { id: `${kind}:${sourcePath}`, kind, sourcePath, userTurns: 0, skipReason: 'empty' }
    const mtime = mtimeMs(sourcePath)
    const prev = reuse.get(sourcePath)
    if (prev && prev.kind === kind && mtime !== undefined && prev.mtimeMs === mtime) return prev
    if (mtime !== undefined && emptyPrev.get(sourcePath) === mtime) {
      emptyNext[sourcePath] = mtime
      return { id: `${kind}:${sourcePath}`, kind, sourcePath, userTurns: 0, mtimeMs: mtime, skipReason: 'empty' }
    }
    if (!shouldContinue()) return { id: `${kind}:${sourcePath}`, kind, sourcePath, userTurns: 0, skipReason: 'empty' }
    const entry = toEntry(kind, sourcePath, convertForeignSource(sourcePath, kind))
    if (entry.userTurns === 0 && mtime !== undefined) emptyNext[sourcePath] = mtime
    return entry
  }

  const add = (entry: ForeignIndexEntry): 'ok' | 'skip' | 'kind-full' | 'full' => {
    if (entry.userTurns === 0) return 'skip'
    if (entries.length >= maxEntries) return 'full'
    const n = counts[entry.kind] ?? 0
    if (n >= maxPerKind) return 'kind-full'
    entries.push(entry)
    counts[entry.kind] = n + 1
    return 'ok'
  }

  const consider = (entry: ForeignIndexEntry): boolean => {
    if (halt) return false
    if (!shouldContinue()) {
      halt = true
      return false
    }
    const result = add(entry)
    if (result === 'full') {
      truncated = true
      halt = true
      return false
    }
    if (result === 'kind-full') {
      truncated = true
      return false
    }
    return true
  }

  const grokRoot = join(home, '.grok', 'sessions')
  grok: for (const encodedCwd of listDirs(grokRoot, shouldContinue)) {
    if (halted()) break
    for (const sessionDir of listDirs(encodedCwd, shouldContinue)) {
      if (halted()) break grok
      if (!existsSync(join(sessionDir, 'summary.json')) && !existsSync(join(sessionDir, 'chat_history.jsonl'))) {
        continue
      }
      if (!consider(entryFor('grok', sessionDir))) break grok
      yield
    }
  }

  const claudeRoot = join(home, '.claude', 'projects')
  claude: for (const projectDir of listDirs(claudeRoot, shouldContinue)) {
    if (halted()) break
    for (const jsonl of listFiles(projectDir, '.jsonl', shouldContinue)) {
      if (!consider(entryFor('claude', jsonl))) break claude
      yield
    }
  }

  const codexRoot = join(home, '.codex', 'sessions')
  if (!halted()) {
    for (const jsonl of walkFiles(codexRoot, '.jsonl', 4, halted)) {
      if (!consider(entryFor('codex', jsonl))) break
      yield
    }
  }

  if (!halted()) {
    opencode: for (const root of [join(home, '.local', 'share', 'opencode'), join(home, '.opencode')]) {
      for (const db of [...walkFiles(root, '.db', 3, halted), ...walkFiles(root, '.sqlite', 3, halted)]) {
        if (
          !consider({
            id: `opencode:${db}`,
            kind: 'opencode',
            sourcePath: db,
            title: redactSecrets(db).text,
            userTurns: 0,
            skipReason: 'empty',
          })
        ) {
          break opencode
        }
      }
    }
  }

  const hermesRoot = join(home, '.hermes', 'sessions')
  if (!halted()) {
    for (const jsonl of walkFiles(hermesRoot, '.jsonl', 3, halted)) {
      if (!consider(entryFor('hermes', jsonl))) break
      yield
    }
  }

  const homeJoin = (...segments: string[]) => join(home, ...segments)
  const transcriptDir = (file: string) => file.replaceAll('\\', '/').includes('/agent-transcripts/')
  // OMP / pi keep the main transcript at sessions/<cwd>/<id>.jsonl and put
  // sub-agent transcripts in sessions/<cwd>/<id>/*.jsonl. Only top-level
  // sessions are chats the user had; sub-agent logs would flood the list.
  const sessionsDir = (file: string) => {
    const posix = file.replaceAll('\\', '/')
    const at = posix.lastIndexOf('/sessions/')
    if (at < 0) return false
    const rest = posix.slice(at + '/sessions/'.length)
    return rest.split('/').length <= 2
  }
  yield* scanKindFiles('chatgpt', [homeJoin('.chatgpt'), homeJoin('Downloads', 'chatgpt'), homeJoin('Downloads', 'ChatGPT')], ['.json', '.jsonl'], 3, consider, halted, entryFor)
  yield* scanKindFiles('deepseek', [homeJoin('.deepseek'), homeJoin('Downloads', 'deepseek')], ['.json', '.jsonl'], 3, consider, halted, entryFor)
  yield* scanKindFiles('gemini', [homeJoin('.gemini')], ['.jsonl', '.json'], 4, consider, halted, entryFor)
  yield* scanKindFiles('qwen', [homeJoin('.qwen')], ['.jsonl', '.json'], 4, consider, halted, entryFor)
  yield* scanKindFiles('amp', [homeJoin('.local', 'share', 'amp'), homeJoin('.amp'), homeJoin('Library', 'Application Support', 'amp'), homeJoin('AppData', 'Roaming', 'amp')], ['.json'], 3, consider, halted, entryFor)
  yield* scanKindFiles('cursor', [homeJoin('.cursor', 'projects')], ['.jsonl'], 4, consider, halted, entryFor, transcriptDir)
  yield* scanKindFiles('openclaw', [homeJoin('.openclaw')], ['.jsonl'], 5, consider, halted, entryFor)
  yield* scanKindFiles('omp', [homeJoin('.omp')], ['.jsonl'], 4, consider, halted, entryFor, sessionsDir)
  yield* scanKindFiles('pi', [homeJoin('.pi')], ['.jsonl'], 4, consider, halted, entryFor, sessionsDir)
  yield* scanKindFiles('kiro', [homeJoin('.kiro', 'projects')], ['.jsonl'], 4, consider, halted, entryFor, transcriptDir)
  yield* scanKindFiles('kimi', [homeJoin('.kimi')], ['.jsonl', '.json'], 3, consider, halted, entryFor)
  yield* scanKindFiles('glm', [homeJoin('.glm')], ['.jsonl', '.json'], 3, consider, halted, entryFor)
  yield* scanKindFiles('z', [homeJoin('.zai'), homeJoin('.zagent')], ['.jsonl', '.json'], 3, consider, halted, entryFor)

  const scannedAt = options.now ?? Date.now()
  const cachePath = foreignImportScanCachePath(options.workspaceRoot)
  const aborted = !shouldContinue()
  if (options.writeCache !== false && !aborted) {
    mkdirSync(dirname(cachePath), { recursive: true })
    writeFileSync(cachePath, `${JSON.stringify({ scannedAt, entries, truncated, empties: emptyNext })}\n`)
  }

  return { entries, scannedAt, cachePath, truncated, aborted }
}

/** Synchronous scan (tests, CLI). Prefer discoverForeignSessionsAsync in the app. */
export function discoverForeignSessions(options: DiscoverForeignOptions): ForeignDiscoverResult {
  const iter = discoverForeignSessionsIter(options)
  for (;;) {
    const step = iter.next()
    if (step.done) return step.value
  }
}

/**
 * Same scan, but yields to the event loop every `sliceMs` of work so the
 * Electron main process stays responsive while thousands of chats are parsed.
 */
export async function discoverForeignSessionsAsync(
  options: DiscoverForeignOptions & { sliceMs?: number },
): Promise<ForeignDiscoverResult> {
  const sliceMs = options.sliceMs ?? 12
  const iter = discoverForeignSessionsIter(options)
  let sliceStart = Date.now()
  for (;;) {
    const step = iter.next()
    if (step.done) return step.value
    if (Date.now() - sliceStart >= sliceMs) {
      await new Promise<void>((resolve) => setImmediate(resolve))
      sliceStart = Date.now()
    }
  }
}

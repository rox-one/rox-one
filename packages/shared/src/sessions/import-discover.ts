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
import { foreignImportScanCachePath } from './import-registry.ts'
import type { ForeignDiscoverResult, ForeignIndexEntry, ForeignSessionKind } from './import-types.ts'

export const MAX_SCAN_ENTRIES = 100_000
export const MAX_SCAN_PER_KIND = 20_000

export interface DiscoverForeignOptions {
  workspaceRoot: string
  homeDir?: string
  writeCache?: boolean
  now?: number
  maxEntries?: number
  maxPerKind?: number
}

function listDirs(path: string): string[] {
  if (!existsSync(path)) return []
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.'))
      .map((entry) => join(path, entry.name))
  } catch {
    return []
  }
}

function listFiles(path: string, suffix: string): string[] {
  if (!existsSync(path)) return []
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(suffix))
      .map((entry) => join(path, entry.name))
      .filter((file) => {
        const maxBytes = file.endsWith('.json') && !file.endsWith('.jsonl') ? MAX_FOREIGN_EXPORT_BYTES : undefined
        return inspectForeignSource(file, maxBytes).status === 'ok'
      })
  } catch {
    return []
  }
}

function walkFiles(root: string, suffix: string, maxDepth: number, depth = 0): string[] {
  if (depth > maxDepth || !existsSync(root)) return []
  try {
    if (lstatSync(root).isSymbolicLink()) return []
  } catch {
    return []
  }
  const files = listFiles(root, suffix)
  if (depth === maxDepth) return files
  for (const dir of listDirs(root)) {
    files.push(...walkFiles(dir, suffix, maxDepth, depth + 1))
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

function expandChatSources(
  kind: ForeignSessionKind,
  file: string,
  consider: (entry: ForeignIndexEntry) => boolean,
): boolean {
  if (shouldSkipFile(file)) return true
  if (basename(file) === 'conversations.json') {
    const listed = listChatExportConversations(file)
    if (listed.length > 1) {
      for (const conv of listed) {
        const sourcePath = `${file}#${conv.id}`
        if (!consider(toEntry(kind, sourcePath, convertForeignSource(sourcePath, kind)))) return false
      }
      return true
    }
  }
  return consider(toEntry(kind, file, convertForeignSource(file, kind)))
}

function scanKindFiles(
  kind: ForeignSessionKind,
  roots: string[],
  suffixes: string[],
  depth: number,
  consider: (entry: ForeignIndexEntry) => boolean,
  halted: () => boolean,
  filter?: (file: string) => boolean,
): void {
  if (halted()) return
  for (const root of roots) {
    for (const suffix of suffixes) {
      for (const file of walkFiles(root, suffix, depth)) {
        if (halted()) return
        if (shouldSkipFile(file)) continue
        if (filter && !filter(file)) continue
        if (!expandChatSources(kind, file, consider)) return
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
    skipReason: converted.userTurns === 0 ? 'empty' : undefined,
  }
}

export function discoverForeignSessions(options: DiscoverForeignOptions): ForeignDiscoverResult {
  const home = options.homeDir ?? homedir()
  const entries: ForeignIndexEntry[] = []
  const counts: Partial<Record<ForeignSessionKind, number>> = {}
  const maxEntries = options.maxEntries ?? MAX_SCAN_ENTRIES
  const maxPerKind = options.maxPerKind ?? MAX_SCAN_PER_KIND
  let truncated = false
  let halt = false

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
  grok: for (const encodedCwd of listDirs(grokRoot)) {
    for (const sessionDir of listDirs(encodedCwd)) {
      if (!existsSync(join(sessionDir, 'summary.json')) && !existsSync(join(sessionDir, 'chat_history.jsonl'))) {
        continue
      }
      if (!consider(toEntry('grok', sessionDir, convertForeignSource(sessionDir, 'grok')))) break grok
    }
  }

  const claudeRoot = join(home, '.claude', 'projects')
  claude: for (const projectDir of listDirs(claudeRoot)) {
    if (halt) break
    for (const jsonl of listFiles(projectDir, '.jsonl')) {
      if (!consider(toEntry('claude', jsonl, convertForeignSource(jsonl, 'claude')))) break claude
    }
  }

  const codexRoot = join(home, '.codex', 'sessions')
  if (!halt) {
    for (const jsonl of walkFiles(codexRoot, '.jsonl', 4)) {
      if (!consider(toEntry('codex', jsonl, convertForeignSource(jsonl, 'codex')))) break
    }
  }

  if (!halt) {
    opencode: for (const root of [join(home, '.local', 'share', 'opencode'), join(home, '.opencode')]) {
      for (const db of [...walkFiles(root, '.db', 3), ...walkFiles(root, '.sqlite', 3)]) {
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
  if (!halt) {
    for (const jsonl of walkFiles(hermesRoot, '.jsonl', 3)) {
      if (!consider(toEntry('hermes', jsonl, convertForeignSource(jsonl, 'hermes')))) break
    }
  }

  const homeJoin = (...segments: string[]) => join(home, ...segments)
  const transcriptDir = (file: string) => file.replaceAll('\\', '/').includes('/agent-transcripts/')
  const sessionsDir = (file: string) => file.replaceAll('\\', '/').includes('/sessions/')
  const halted = () => halt

  scanKindFiles('chatgpt', [homeJoin('.chatgpt'), homeJoin('Downloads', 'chatgpt'), homeJoin('Downloads', 'ChatGPT')], ['.json', '.jsonl'], 3, consider, halted)
  scanKindFiles('deepseek', [homeJoin('.deepseek'), homeJoin('Downloads', 'deepseek')], ['.json', '.jsonl'], 3, consider, halted)
  scanKindFiles('gemini', [homeJoin('.gemini')], ['.jsonl', '.json'], 4, consider, halted)
  scanKindFiles('qwen', [homeJoin('.qwen')], ['.jsonl', '.json'], 4, consider, halted)
  scanKindFiles('amp', [homeJoin('.local', 'share', 'amp'), homeJoin('.amp'), homeJoin('Library', 'Application Support', 'amp'), homeJoin('AppData', 'Roaming', 'amp')], ['.json'], 3, consider, halted)
  scanKindFiles('cursor', [homeJoin('.cursor', 'projects')], ['.jsonl'], 4, consider, halted, transcriptDir)
  scanKindFiles('openclaw', [homeJoin('.openclaw')], ['.jsonl'], 5, consider, halted)
  scanKindFiles('omp', [homeJoin('.omp')], ['.jsonl'], 4, consider, halted, sessionsDir)
  scanKindFiles('pi', [homeJoin('.pi')], ['.jsonl'], 4, consider, halted, sessionsDir)
  scanKindFiles('kiro', [homeJoin('.kiro', 'projects')], ['.jsonl'], 4, consider, halted, transcriptDir)
  scanKindFiles('kimi', [homeJoin('.kimi')], ['.jsonl', '.json'], 3, consider, halted)
  scanKindFiles('glm', [homeJoin('.glm')], ['.jsonl', '.json'], 3, consider, halted)
  scanKindFiles('z', [homeJoin('.zai'), homeJoin('.zagent')], ['.jsonl', '.json'], 3, consider, halted)

  const scannedAt = options.now ?? Date.now()
  const cachePath = foreignImportScanCachePath(options.workspaceRoot)
  if (options.writeCache !== false) {
    mkdirSync(dirname(cachePath), { recursive: true })
    writeFileSync(cachePath, `${JSON.stringify({ scannedAt, entries, truncated }, null, 2)}\n`)
  }

  return { entries, scannedAt, cachePath, truncated }
}

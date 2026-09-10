/**
 * Index P0 foreign roots. Writes a scan cache only — never creates Rox sessions.
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { convertForeignSource, inspectForeignSource, redactSecrets } from './import-convert.ts'
import { isSensitiveAgentCwd } from './import-home.ts'
import { foreignImportScanCachePath } from './import-registry.ts'
import type { ForeignDiscoverResult, ForeignIndexEntry, ForeignSessionKind } from './import-types.ts'

export const MAX_SCAN_ENTRIES = 200
export const MAX_SCAN_PER_KIND = 80

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
      .filter((file) => inspectForeignSource(file).status === 'ok')
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
    return lstatSync(path).mtimeMs
  } catch {
    return undefined
  }
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

  const scannedAt = options.now ?? Date.now()
  const cachePath = foreignImportScanCachePath(options.workspaceRoot)
  if (options.writeCache !== false) {
    mkdirSync(dirname(cachePath), { recursive: true })
    writeFileSync(cachePath, `${JSON.stringify({ scannedAt, entries, truncated }, null, 2)}\n`)
  }

  return { entries, scannedAt, cachePath, truncated }
}

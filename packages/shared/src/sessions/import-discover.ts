/**
 * Index P0 foreign roots. Writes a scan cache only — never creates Rox sessions.
 */

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { convertForeignSource } from './import-convert.ts'
import { foreignImportScanCachePath } from './import-registry.ts'
import type { ForeignDiscoverResult, ForeignIndexEntry, ForeignSessionKind } from './import-types.ts'

export interface DiscoverForeignOptions {
  workspaceRoot: string
  homeDir?: string
  writeCache?: boolean
  now?: number
}

function safeStat(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

function listDirs(path: string): string[] {
  if (!existsSync(path)) return []
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => join(path, entry.name))
  } catch {
    return []
  }
}

function listFiles(path: string, suffix: string): string[] {
  if (!existsSync(path)) return []
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => join(path, entry.name))
  } catch {
    return []
  }
}

function walkFiles(root: string, suffix: string, maxDepth: number, depth = 0): string[] {
  if (depth > maxDepth || !existsSync(root)) return []
  const files = listFiles(root, suffix)
  if (depth === maxDepth) return files
  for (const dir of listDirs(root)) {
    files.push(...walkFiles(dir, suffix, maxDepth, depth + 1))
  }
  return files
}

function toEntry(
  kind: ForeignSessionKind,
  sourcePath: string,
  converted: ReturnType<typeof convertForeignSource>,
): ForeignIndexEntry {
  const st = safeStat(sourcePath)
  return {
    id: `${kind}:${sourcePath}`,
    kind,
    sourcePath,
    title: converted.title,
    cwd: converted.cwd,
    userTurns: converted.userTurns,
    mtimeMs: st?.mtimeMs,
    skipReason: converted.userTurns === 0 ? 'empty' : undefined,
  }
}

export function discoverForeignSessions(options: DiscoverForeignOptions): ForeignDiscoverResult {
  const home = options.homeDir ?? homedir()
  const entries: ForeignIndexEntry[] = []

  const grokRoot = join(home, '.grok', 'sessions')
  for (const encodedCwd of listDirs(grokRoot)) {
    for (const sessionDir of listDirs(encodedCwd)) {
      if (!existsSync(join(sessionDir, 'summary.json')) && !existsSync(join(sessionDir, 'chat_history.jsonl'))) {
        continue
      }
      entries.push(toEntry('grok', sessionDir, convertForeignSource(sessionDir, 'grok')))
    }
  }

  const claudeRoot = join(home, '.claude', 'projects')
  for (const projectDir of listDirs(claudeRoot)) {
    for (const jsonl of listFiles(projectDir, '.jsonl')) {
      entries.push(toEntry('claude', jsonl, convertForeignSource(jsonl, 'claude')))
    }
  }

  const codexRoot = join(home, '.codex', 'sessions')
  for (const jsonl of walkFiles(codexRoot, '.jsonl', 4)) {
    entries.push(toEntry('codex', jsonl, convertForeignSource(jsonl, 'codex')))
  }

  for (const root of [join(home, '.local', 'share', 'opencode'), join(home, '.opencode')]) {
    for (const db of [...walkFiles(root, '.db', 3), ...walkFiles(root, '.sqlite', 3)]) {
      entries.push({
        id: `opencode:${db}`,
        kind: 'opencode',
        sourcePath: db,
        title: db,
        userTurns: 0,
        skipReason: 'empty',
      })
    }
  }

  const hermesRoot = join(home, '.hermes', 'sessions')
  for (const jsonl of walkFiles(hermesRoot, '.jsonl', 3)) {
    entries.push(toEntry('hermes', jsonl, convertForeignSource(jsonl, 'hermes')))
  }

  const scannedAt = options.now ?? Date.now()
  const cachePath = foreignImportScanCachePath(options.workspaceRoot)
  if (options.writeCache !== false) {
    mkdirSync(dirname(cachePath), { recursive: true })
    writeFileSync(cachePath, `${JSON.stringify({ scannedAt, entries }, null, 2)}\n`)
  }

  return { entries, scannedAt, cachePath }
}

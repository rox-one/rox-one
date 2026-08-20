/**
 * Watch local source-folder roots and debounce-reindex via the facade.
 *
 * Not a knowledge watcher. Not inside craft-index. Default off:
 * CRAFT_FEATURE_NATIVE_INDEX_WATCH=1.
 */
import { existsSync, watch as fsWatch, type FSWatcher } from 'node:fs'
import { extname } from 'node:path'
import { isNativeIndexWatchEnabled } from '@craft-agent/shared/feature-flags'
import {
  reindexWorkspaceSources,
  type SourceReindexResult,
} from './source-index-facade.ts'

export const SOURCE_INDEX_WATCH_DEBOUNCE_MS = 250
export const SOURCE_INDEX_WATCH_MAX_ROOTS = 32

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.craft',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
])

const TEXT_EXTS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.swift',
  '.css',
  '.html',
  '.xml',
  '.csv',
  '.toml',
  '.ini',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
])

export interface SourceIndexChangedPayload {
  indexed: number
  written?: number
  unchanged?: number
  truncated: boolean
}

export interface SourceIndexWatchHandle {
  close(): void
}

export interface SourceIndexWatchDeps {
  watch?: typeof fsWatch
  reindex?: (
    workspaceRoot: string,
    roots: Array<{ slug: string; path: string }>,
  ) => Promise<SourceReindexResult>
  debounceMs?: number
  maxRoots?: number
  push?: (payload: SourceIndexChangedPayload) => void
}

const live = new Map<string, SourceIndexWatchHandle>()

export function isWatchedSourcePath(relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]/).filter(Boolean)
  if (parts.some((part) => SKIP_DIRS.has(part))) return false
  const ext = extname(relativePath).toLowerCase()
  if (ext && !TEXT_EXTS.has(ext)) return false
  return true
}

export function startSourceIndexWatch(
  workspaceRoot: string,
  roots: Array<{ slug: string; path: string }>,
  deps: SourceIndexWatchDeps = {},
): SourceIndexWatchHandle | null {
  if (!isNativeIndexWatchEnabled()) return null
  const existing = live.get(workspaceRoot)
  existing?.close()

  const maxRoots = deps.maxRoots ?? SOURCE_INDEX_WATCH_MAX_ROOTS
  const limited = roots
    .filter((root) => typeof root.path === 'string' && root.path.length > 0 && existsSync(root.path))
    .slice(0, maxRoots)
  if (limited.length === 0) return null

  const watchFn = deps.watch ?? fsWatch
  const reindexFn = deps.reindex ?? reindexWorkspaceSources
  const debounceMs = deps.debounceMs ?? SOURCE_INDEX_WATCH_DEBOUNCE_MS
  const watchers: FSWatcher[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let closed = false

  const flush = async (): Promise<void> => {
    if (closed) return
    const result = await reindexFn(workspaceRoot, limited)
    deps.push?.({
      indexed: result.indexed,
      written: result.written,
      unchanged: result.unchanged,
      truncated: result.truncated,
    })
  }

  const schedule = (filename: string | Buffer | null | undefined): void => {
    if (closed) return
    const name = filename == null ? '' : String(filename)
    if (name && !isWatchedSourcePath(name)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void flush()
    }, debounceMs)
  }

  for (const root of limited) {
    try {
      const watcher = watchFn(root.path, { recursive: true, persistent: false }, (_event, file) => {
        schedule(file)
      })
      watchers.push(watcher)
    } catch {
      // Unwatchable root (permissions, network fs) — skip.
    }
  }
  if (watchers.length === 0) return null

  const handle: SourceIndexWatchHandle = {
    close() {
      closed = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      for (const watcher of watchers) {
        try {
          watcher.close()
        } catch {
          // already closed
        }
      }
      watchers.length = 0
      if (live.get(workspaceRoot) === handle) live.delete(workspaceRoot)
    },
  }
  live.set(workspaceRoot, handle)
  return handle
}

export function stopAllSourceIndexWatches(): void {
  for (const handle of [...live.values()]) handle.close()
  live.clear()
}

export function syncWorkspaceSourceWatch(
  workspaceRoot: string,
  roots: Array<{ slug: string; path: string }>,
  deps: SourceIndexWatchDeps = {},
): SourceIndexWatchHandle | null {
  return startSourceIndexWatch(workspaceRoot, roots, deps)
}

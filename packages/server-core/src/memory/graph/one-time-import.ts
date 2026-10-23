/**
 * One-time resumable backfill of native memory docs into the graph provider.
 * Never deletes native memory or graph data. Progress checkpoint lives under
 * the workspace cognee storage dir as `import-state.json`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { GraphMemoryProvider } from '@rox/shared/memory/graph-provider'
import type { ChunkSourceDoc } from '../chunk-index'
import { toInjectableGraphDocs } from './ingest'
import {
  DEFAULT_COGNIFY_ESTIMATE_USD,
  DEFAULT_GRAPH_DAILY_COST_CAP_USD,
  tryReserveGraphSpend,
} from './cost-cap'

export const GRAPH_IMPORT_STATE_FILE = 'import-state.json'
export const GRAPH_IMPORT_BATCH = 50

export type GraphImportStatus = 'idle' | 'running' | 'done' | 'failed'

export interface GraphImportState {
  version: 1
  status: GraphImportStatus
  /** Number of injectable docs successfully ingested (resume cursor). */
  cursor: number
  /** Last known injectable total (informational; recomputed each run). */
  total: number
  startedAt?: string
  updatedAt: string
  completedAt?: string
  safeError?: string
}

export function emptyGraphImportState(now = Date.now()): GraphImportState {
  return {
    version: 1,
    status: 'idle',
    cursor: 0,
    total: 0,
    updatedAt: new Date(now).toISOString(),
  }
}

export function graphImportStatePath(storageDir: string): string {
  return join(storageDir, GRAPH_IMPORT_STATE_FILE)
}

export function readGraphImportState(storageDir: string): GraphImportState {
  const path = graphImportStatePath(storageDir)
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<GraphImportState>
    if (raw && raw.version === 1 && typeof raw.cursor === 'number') {
      return {
        version: 1,
        status: raw.status === 'running' || raw.status === 'done' || raw.status === 'failed' ? raw.status : 'idle',
        cursor: Math.max(0, Math.floor(raw.cursor)),
        total: typeof raw.total === 'number' ? Math.max(0, Math.floor(raw.total)) : 0,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
        ...(typeof raw.startedAt === 'string' ? { startedAt: raw.startedAt } : {}),
        ...(typeof raw.completedAt === 'string' ? { completedAt: raw.completedAt } : {}),
        ...(typeof raw.safeError === 'string' ? { safeError: raw.safeError } : {}),
      }
    }
  } catch {
    /* absent/corrupt → idle */
  }
  return emptyGraphImportState()
}

export function writeGraphImportState(storageDir: string, state: GraphImportState): void {
  mkdirSync(storageDir, { recursive: true })
  writeFileSync(graphImportStatePath(storageDir), JSON.stringify(state))
}

export interface RunGraphOneTimeImportOptions {
  storageDir: string
  provider: GraphMemoryProvider
  /** All native docs; untrusted filtered inside. */
  docs: readonly ChunkSourceDoc[]
  allowedSources?: ReadonlySet<string> | null
  batchSize?: number
  dailyCostCapUsd?: number
  cognifyEstimateUsd?: number
  runCognify?: boolean
  roxHome?: string
  logger?: { warn: (m: string, e?: unknown) => void }
  /** Abort cooperative loop. */
  shouldStop?: () => boolean
}

export interface RunGraphOneTimeImportResult {
  state: GraphImportState
  ingested: number
}

/**
 * Resume (or start) a one-time import. Soft-fails on provider errors without
 * clearing the cursor. Never deletes docs. Idempotent when status === 'done'.
 */
export async function runGraphOneTimeImport(opts: RunGraphOneTimeImportOptions): Promise<RunGraphOneTimeImportResult> {
  const storageDir = opts.storageDir
  let state = readGraphImportState(storageDir)
  if (state.status === 'done') {
    return { state, ingested: 0 }
  }

  const status = opts.provider.status()
  if (status.state === 'disabled' || status.state === 'not_installed' || status.state === 'failed') {
    state = {
      ...state,
      status: 'failed',
      safeError: `provider ${status.state}`,
      updatedAt: new Date().toISOString(),
    }
    writeGraphImportState(storageDir, state)
    return { state, ingested: 0 }
  }

  const injectable = toInjectableGraphDocs(opts.docs, opts.allowedSources)
  // Stable order for resume: by id
  injectable.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const nowIso = () => new Date().toISOString()
  state = {
    ...state,
    status: 'running',
    total: injectable.length,
    startedAt: state.startedAt ?? nowIso(),
    updatedAt: nowIso(),
    safeError: undefined,
  }
  // Clamp cursor if corpus shrank
  if (state.cursor > injectable.length) state.cursor = injectable.length
  writeGraphImportState(storageDir, state)

  const batch = Math.max(1, opts.batchSize ?? GRAPH_IMPORT_BATCH)
  let ingested = 0

  try {
    while (state.cursor < injectable.length) {
      if (opts.shouldStop?.()) break
      const slice = injectable.slice(state.cursor, state.cursor + batch)
      await opts.provider.ingest(slice)
      state = {
        ...state,
        cursor: state.cursor + slice.length,
        updatedAt: nowIso(),
      }
      ingested += slice.length
      writeGraphImportState(storageDir, state)
    }

    if (state.cursor >= injectable.length) {
      if (opts.runCognify !== false) {
        const withCognify = opts.provider as unknown as { cognify?: () => Promise<void> }
        if (typeof withCognify.cognify === 'function') {
          const estimate = opts.cognifyEstimateUsd ?? DEFAULT_COGNIFY_ESTIMATE_USD
          const cap = opts.dailyCostCapUsd ?? DEFAULT_GRAPH_DAILY_COST_CAP_USD
          if (tryReserveGraphSpend(estimate, cap, opts.roxHome)) {
            try {
              await withCognify.cognify!()
            } catch (err) {
              opts.logger?.warn('graph one-time import cognify failed', err)
            }
          } else {
            opts.logger?.warn('graph one-time import cognify skipped: daily cost cap reached')
          }
        }
      }
      state = {
        ...state,
        status: 'done',
        completedAt: nowIso(),
        updatedAt: nowIso(),
      }
      writeGraphImportState(storageDir, state)
    }
  } catch (err) {
    opts.logger?.warn('graph one-time import failed', err)
    state = {
      ...state,
      status: 'failed',
      safeError: 'import failed',
      updatedAt: nowIso(),
    }
    writeGraphImportState(storageDir, state)
  }

  return { state, ingested }
}

/** True when a one-time import has never completed for this storage dir. */
export function graphImportPending(storageDir: string): boolean {
  if (!existsSync(storageDir)) return true
  return readGraphImportState(storageDir).status !== 'done'
}

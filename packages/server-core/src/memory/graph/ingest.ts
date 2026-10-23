/**
 * Bridge native memory docs → cognee ingest + gated cognify.
 * Untrusted docs never leave this module; cold/failed sidecar soft-fails.
 */
import { createHash } from 'crypto'
import type { GraphMemoryDocument, GraphMemoryProvider, GraphMemorySource } from '@rox/shared/memory/graph-provider'
import { isMemoryOriginInjectable } from '@rox/shared/memory/document-provenance'
import type { ChunkSourceDoc } from '../chunk-index'
import {
  DEFAULT_COGNIFY_ESTIMATE_USD,
  DEFAULT_GRAPH_DAILY_COST_CAP_USD,
  tryReserveGraphSpend,
} from './cost-cap'

export function graphSourceForPath(path: string): GraphMemorySource {
  const p = path.replace(/\\/g, '/')
  if (p.includes('/lessons')) return 'lessons'
  if (p.includes('/history/')) return 'session'
  if (p.startsWith('projects/')) return 'notes'
  if (p.includes('tasks')) return 'tasks'
  if (p.includes('mail')) return 'mail'
  if (p.includes('chats') || p.includes('chat')) return 'chats'
  if (p.includes('calls') || p.includes('call')) return 'calls'
  if (p.includes('files') || p.includes('file')) return 'files'
  return 'notes'
}

export function docIdForPath(path: string): string {
  return 'doc-' + createHash('sha1').update(path.replace(/\\/g, '/')).digest('hex').slice(0, 24)
}

/** Filter to injectable (owner/agent) docs and map to GraphMemoryDocument. */
export function toInjectableGraphDocs(docs: readonly ChunkSourceDoc[]): GraphMemoryDocument[] {
  const out: GraphMemoryDocument[] = []
  for (const d of docs) {
    if (!d?.content?.trim()) continue
    if (!isMemoryOriginInjectable(d.provenance?.originClass)) continue
    out.push({
      id: docIdForPath(d.path),
      source: graphSourceForPath(d.path),
      text: d.content,
      provenance: d.provenance,
      ref: d.path,
    })
  }
  return out
}

export interface ScheduleGraphIngestOptions {
  provider: GraphMemoryProvider | null | undefined
  docs: readonly ChunkSourceDoc[]
  /** Daily USD cap for cognify; default {@link DEFAULT_GRAPH_DAILY_COST_CAP_USD}. */
  dailyCostCapUsd?: number
  /** Estimated USD per cognify; default {@link DEFAULT_COGNIFY_ESTIMATE_USD}. */
  cognifyEstimateUsd?: number
  /** When false, skip cognify (ingest only). Default true. */
  runCognify?: boolean
  logger?: { warn: (m: string, e?: unknown) => void }
  roxHome?: string
}

/** Coalesce overlapping fire-and-forget runs (rebuild storms). */
let ingestTail: Promise<void> = Promise.resolve()

/**
 * Fire-and-forget ingest (+ optional cognify under the daily cost cap).
 * Never throws into the caller; never blocks rebuild on a cold sidecar.
 * Concurrent calls are serialized so we do not stampede cognify.
 */
export function scheduleGraphIngest(opts: ScheduleGraphIngestOptions): void {
  const provider = opts.provider
  if (!provider) return
  const status = provider.status()
  // Soft-fail: never block rebuild. disabled/not_installed/failed → skip.
  // cold/warming/ready → fire-and-forget (provider.ingest warms without awaiting callers).
  if (status.state === 'disabled' || status.state === 'not_installed' || status.state === 'failed') return
  const injectable = toInjectableGraphDocs(opts.docs)
  if (injectable.length === 0) return

  ingestTail = ingestTail
    .catch(() => {})
    .then(async () => {
      try {
        await provider.ingest(injectable)
      } catch (err) {
        opts.logger?.warn('graph ingest failed', err)
        return
      }
      if (opts.runCognify === false) return
      if (typeof (provider as { cognify?: (s?: string[]) => Promise<void> }).cognify !== 'function') return
      const estimate = opts.cognifyEstimateUsd ?? DEFAULT_COGNIFY_ESTIMATE_USD
      const cap = opts.dailyCostCapUsd ?? DEFAULT_GRAPH_DAILY_COST_CAP_USD
      // Reserve before cognify so concurrent rebuilds cannot TOCTOU past the cap.
      if (!tryReserveGraphSpend(estimate, cap, opts.roxHome)) {
        opts.logger?.warn('graph cognify skipped: daily cost cap reached')
        return
      }
      try {
        await (provider as { cognify: (s?: string[]) => Promise<void> }).cognify()
      } catch (err) {
        opts.logger?.warn('graph cognify failed', err)
      }
    })
}

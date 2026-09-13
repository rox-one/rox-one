import type { SessionMeta } from '@/atoms/sessions'
import {
  LOCAL_EXCERPT_TEMPLATE,
  localExcerptMapper,
  mapReduceProductResult,
  runMapReduce,
  snapshotSelection,
  type MapSource,
  type ReduceResult,
} from '@craft-agent/core/rox2'

export function mapSourcesFromSessionMeta(
  ids: readonly string[],
  metaById: ReadonlyMap<string, SessionMeta>,
): MapSource[] {
  return ids.map((id) => {
    const meta = metaById.get(id)
    return {
      id,
      revision: String(meta?.lastMessageAt ?? 0),
      title: meta?.name?.trim() || id,
      preview: meta?.preview?.trim() || '',
    }
  })
}

export async function mapReduceVisibleSessions(opts: {
  ids: readonly string[]
  metaById: ReadonlyMap<string, SessionMeta>
  signal?: AbortSignal
}): Promise<ReduceResult> {
  const sources = mapSourcesFromSessionMeta(opts.ids, opts.metaById)
  const snapshot = snapshotSelection(sources, opts.ids)
  return runMapReduce({
    snapshot,
    sources,
    template: LOCAL_EXCERPT_TEMPLATE,
    mapper: localExcerptMapper,
    signal: opts.signal,
  })
}

export { mapReduceProductResult }

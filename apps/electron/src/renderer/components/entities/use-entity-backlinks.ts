/**
 * W1-08 (#1505) — backlinks for one entity, via the data-source adapter.
 * Does nothing while `enabled` is false. Refreshes on `entities:linksChanged`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { entityRefKey, type EntityLink, type EntityRef } from '@rox/core/entities'
import { getEntityDataSource } from './entity-data-source'

export type EntityBacklinksState =
  | { status: 'idle'; links: EntityLink[] }
  | { status: 'loading'; links: EntityLink[] }
  | { status: 'ready'; links: EntityLink[]; nextCursor?: string }
  | { status: 'error'; links: EntityLink[] }

export const BACKLINKS_PAGE_SIZE = 50

export function useEntityBacklinks(ref: EntityRef | null, workspaceId: string | null | undefined, enabled: boolean) {
  const [state, setState] = useState<EntityBacklinksState>({ status: 'idle', links: [] })
  const generation = useRef(0)
  const key = ref ? entityRefKey(ref) : ''

  const load = useCallback(async (cursor?: string) => {
    if (!enabled || !workspaceId || !ref) return
    const current = ++generation.current
    setState((prev) => ({ status: 'loading', links: cursor ? prev.links : [] }))
    try {
      const page = await getEntityDataSource().backlinks(workspaceId, ref, { limit: BACKLINKS_PAGE_SIZE, ...(cursor ? { cursor } : {}) })
      if (current !== generation.current) return
      setState((prev) => ({
        status: 'ready',
        links: cursor ? [...prev.links, ...page.links] : page.links,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      }))
    } catch {
      if (current !== generation.current) return
      setState((prev) => ({ status: 'error', links: prev.links }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, workspaceId, key])

  useEffect(() => {
    if (!enabled || !workspaceId || !ref) {
      generation.current++
      setState({ status: 'idle', links: [] })
      return
    }
    void load()
    return getEntityDataSource().onLinksChanged((changed) => {
      if (changed === workspaceId) void load()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  const loadMore = useCallback(() => {
    if (state.status === 'ready' && state.nextCursor) void load(state.nextCursor)
  }, [state, load])

  return { state, retry: () => { void load() }, loadMore }
}

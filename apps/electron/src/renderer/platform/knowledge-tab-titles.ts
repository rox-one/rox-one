import type { SurfaceKnowledgeRef } from './layout-snapshot'
import { knowledgeRefKey } from './surface-tab-model'

export interface KnowledgeTabTitleAPI {
  listConnections: () => Promise<ReadonlyArray<{ id: string }>>
  get: (input: { workspaceId: string; connectionId: string; ref: SurfaceKnowledgeRef }) => Promise<{ title?: string | null } | null | undefined>
}

/**
 * Renders may stop awaiting a batch when the tab stack changes. Its requests
 * stay shareable by the next batch; only successful titles enter the cache.
 * Failed/offline requests can retry on the next navigation without polling.
 */
export function createKnowledgeTabTitleLoader() {
  const titles = new Map<string, string>()
  const pending = new Map<string, Promise<string | null>>()
  const maximumCachedTitles = 256

  return {
    async load(workspaceId: string, refs: readonly SurfaceKnowledgeRef[], api: KnowledgeTabTitleAPI): Promise<ReadonlyMap<string, string>> {
      let connection: Promise<string | null> | undefined
      const getConnection = () => connection ??= Promise.resolve()
        .then(() => api.listConnections())
        .then(connections => connections[0]?.id ?? null)
        .catch(() => null)
      const resolved = await Promise.all(refs.map(async ref => {
        const key = `${workspaceId}:${knowledgeRefKey(ref)}`
        const cached = titles.get(key)
        if (cached) return [key, cached] as const
        let request = pending.get(key)
        if (!request) {
          request = (async () => {
            try {
              const connectionId = await getConnection()
              if (!connectionId) return null
              const node = await api.get({ workspaceId, connectionId, ref })
              return node?.title?.trim() || null
            } catch {
              return null
            }
          })()
          pending.set(key, request)
          void request.then(title => {
            pending.delete(key)
            if (!title) return
            titles.set(key, title)
            if (titles.size > maximumCachedTitles) titles.delete(titles.keys().next().value!)
          })
        }
        return [key, await request] as const
      }))
      return new Map(resolved.filter((entry): entry is readonly [string, string] => entry[1] !== null))
    },
  }
}

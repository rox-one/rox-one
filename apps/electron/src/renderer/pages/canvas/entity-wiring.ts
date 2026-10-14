/**
 * «Доска» ↔ Rox entities, renderer side. Card titles/previews are resolved per
 * viewer through `entitiesResolve` (server-side access check; `no_access` →
 * forbidden) and never written to the board doc. Links go through the shared
 * entity-links RPC: board card `{kind:'canvas', id:<board>, fragment:<object>}`
 * --embeds--> entity.
 */
import { EntityKindRegistry, EntitySnapshotResolver, type EntityLinker, type EntityRef } from '@rox/canvas-core'
import { ENTITY_KINDS, kindDescriptor, type EntityKind, type EntityPreview, type EntityLink } from '@rox/core/entities'
import { openEntity } from '@/components/entities/open-entity'

interface Bridge {
  entitiesResolve?: (ws: string, input: { refs: Array<{ kind: EntityKind; id: string }> }) => Promise<EntityPreview[]>
  entitiesLinks?: (ws: string, input: unknown) => Promise<unknown>
}
const api = (): Bridge => ((window as unknown as { electronAPI?: Bridge }).electronAPI) ?? {}

export function createEntityRegistry(workspaceId: string): EntityKindRegistry {
  const registry = new EntityKindRegistry()
  const preview = async (ref: EntityRef): Promise<EntityPreview | null> => {
    const r = api().entitiesResolve
    if (!r) return null
    const [p] = await r(workspaceId, { refs: [{ kind: ref.kind as EntityKind, id: ref.id }] })
    return p ?? null
  }
  for (const kind of ENTITY_KINDS) {
    if (kind === 'canvas') continue
    const d = kindDescriptor(kind)
    registry.register({
      kind, labelKey: d.labelKey, icon: d.icon, creatable: false,
      async canView(ref) { const p = await preview(ref); return !!p && p.status !== 'no_access' },
      async read(ref) {
        const p = await preview(ref)
        if (!p || p.status === 'tombstone' || p.status === 'unavailable' || p.status === 'no_access') return null
        return { title: p.title, icon: p.icon }
      },
      open(ref) { openEntity({ kind: ref.kind as EntityKind, id: ref.id }) },
    })
  }
  return registry
}

/** `currentUserId` unknown → no link counts as mine, so reconcile never removes links (safe default). */
export function createEntityLinker(workspaceId: string, currentUserId?: string): EntityLinker {
  const call = async (input: unknown) => {
    const l = api().entitiesLinks
    if (!l) throw new Error('entity links unavailable')
    const res = await l(workspaceId, input) as { ok: boolean } | undefined
    if (!res?.ok) throw new Error('entity links disabled')
    return res
  }
  const from = (f: { boardId: string; objectId: string }) => ({ kind: 'canvas', id: f.boardId, fragment: f.objectId })
  return {
    async link(f, to) { await call({ op: 'add', from: from(f), to: { kind: to.kind, id: to.id }, relation: 'embeds' }) },
    async unlink(f, to) { await call({ op: 'remove', from: from(f), to: { kind: to.kind, id: to.id }, relation: 'embeds' }) },
    async list(boardId) {
      const res = await call({ op: 'outgoing', ref: { kind: 'canvas', id: boardId } }) as { links?: EntityLink[] }
      return (res.links ?? []).filter(l => l.relation === 'embeds' && l.from.fragment).map(l => ({ objectId: l.from.fragment!, ref: { kind: l.to.kind, id: l.to.id }, mine: currentUserId !== undefined && l.createdBy === currentUserId }))
    },
  }
}

export { EntitySnapshotResolver }

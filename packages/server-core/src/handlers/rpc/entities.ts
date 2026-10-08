/**
 * W1-02 — Entity RPC handlers.
 *
 * `entities:links` is a single dispatcher over the local link store
 * (`op: add | remove | outgoing | backlinks`); `entities:resolve` resolves a
 * batch of refs into previews through a per-workspace resolver host.
 *
 * Inert when off: gated by `isEntitiesLinksEnabled()` (default OFF). While the
 * flag is off no store is opened, nothing is written, `add`/`remove` report
 * `ok: false, reason: 'disabled'`, reads come back empty and resolution
 * returns per-ref `unavailable` placeholders to keep the response shape.
 */

import { RPC_CHANNELS } from '@rox/shared/protocol'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import { isEntitiesLinksEnabled } from '@rox/shared/feature-flags'
import {
  entityLinksRequestSchema,
  entityResolveRequestSchema,
  type EntityLinksRequest,
} from '@rox/shared/entities'
import { pushTyped, type RpcServer } from '@rox/server-core/transport'
import type { Actor, EntityLink, EntityPreview, EntityRef, Resolver } from '@rox/core/entities'
import type { RequestContext } from '../../transport/types.ts'
import type { HandlerDeps } from '../handler-deps'
import { getEntityLinkStore } from '../../entities/link-store.ts'
import { DefaultResolverHost } from '../../entities/resolver-host.ts'

export const HANDLED_CHANNELS = [RPC_CHANNELS.entities.LINKS, RPC_CHANNELS.entities.RESOLVE] as const

/** Result of the `entities:links` dispatcher. */
export type EntitiesLinksResult =
  | { ok: true; op: 'add'; link: EntityLink }
  | { ok: true; op: 'remove'; removed: boolean }
  | { ok: true; op: 'outgoing'; links: EntityLink[] }
  | { ok: true; op: 'backlinks'; links: EntityLink[]; nextCursor?: string }
  | { ok: false; reason: 'disabled' }

/**
 * Resolver registrations replayed into every workspace host. Hosts are
 * scoped per workspace so cached previews never cross workspace boundaries;
 * the underlying LRU is additionally keyed per actor (see resolver-host).
 */
const resolverRegistrations: Resolver[] = []
const hostsByWorkspace = new Map<string, DefaultResolverHost>()

function hostForWorkspace(workspaceId: string): DefaultResolverHost {
  let host = hostsByWorkspace.get(workspaceId)
  if (!host) {
    host = new DefaultResolverHost()
    for (const resolver of resolverRegistrations) host.register(resolver)
    hostsByWorkspace.set(workspaceId, host)
  }
  return host
}

/** DI seam for owner modules (tasks, notes, goals, …) to serve local previews. */
export function registerEntityResolver(resolver: Resolver): void {
  resolverRegistrations.push(resolver)
  for (const host of hostsByWorkspace.values()) host.register(resolver)
}

export function resetEntityResolvers(): void {
  resolverRegistrations.length = 0
  hostsByWorkspace.clear()
}

function unavailablePreview(ref: EntityRef): EntityPreview {
  return {
    ref,
    status: 'unavailable',
    title: '',
    kindLabel: `entities.kind.${ref.kind}`,
    icon: 'link',
    authority: 'local',
    etag: '',
  }
}

/**
 * Strip entity data from previews the actor must not see. Mirrors
 * `applyPreviewRedaction` but keeps the `EntityPreview` wire shape: only
 * the ref survives, everything else is cleared.
 */
function redactPreviewForWire(preview: EntityPreview): EntityPreview {
  if (preview.status === 'no_access' || preview.status === 'unavailable' || preview.status === 'tombstone') {
    return {
      ref: preview.ref,
      status: preview.status,
      title: '',
      kindLabel: preview.kindLabel,
      icon: preview.icon,
      authority: preview.authority,
      etag: '',
    }
  }
  return preview
}

export interface EntitiesHandlerRuntime {
  /** Host-provided workspace lookup (tests pass a fixed map). */
  workspaceFor?: (id: string) => { id: string; rootPath: string } | null
  /**
   * Enabled workbench flags for this host (user-toggleable). When it contains
   * `entities.links.v1` the subsystem is enabled; `CRAFT_FEATURE_ENTITIES_LINKS`
   * remains as an explicit env override (see `isEntitiesLinksEnabled`).
   */
  enabledWorkbenchFlags?: ReadonlySet<string>
}

function isEnabled(runtime: EntitiesHandlerRuntime): boolean {
  return isEntitiesLinksEnabled(runtime.enabledWorkbenchFlags)
}

function actorFor(ctx: RequestContext): Actor {
  const id = ctx.actor?.principalId ?? ctx.principal?.credentialId ?? 'local'
  return { id, kind: ctx.actor ? 'user' : 'system' }
}

export function registerEntitiesHandlers(server: RpcServer, _deps: HandlerDeps, runtime: EntitiesHandlerRuntime = {}): void {
  const workspaceFor = runtime.workspaceFor ?? (getWorkspaceByNameOrId as (id: string) => { id: string; rootPath: string } | null)

  const requireWorkspaceRoot = (workspaceId: string): string => {
    const workspace = workspaceFor(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    return workspace.rootPath
  }

  server.handle(RPC_CHANNELS.entities.LINKS, async (ctx, workspaceId: string, input: unknown): Promise<EntitiesLinksResult> => {
    const request: EntityLinksRequest = entityLinksRequestSchema.parse(input)
    if (!isEnabled(runtime)) {
      if (request.op === 'add' || request.op === 'remove') return { ok: false, reason: 'disabled' }
      return request.op === 'outgoing'
        ? { ok: true, op: 'outgoing', links: [] }
        : { ok: true, op: 'backlinks', links: [] }
    }
    const root = requireWorkspaceRoot(workspaceId)
    const store = getEntityLinkStore(root)

    switch (request.op) {
      case 'add': {
        const link = store.add({
          from: request.from,
          to: request.to,
          relation: request.relation,
          role: request.role,
          anchor: request.anchor,
          createdBy: actorFor(ctx).id,
        })
        pushTyped(server, RPC_CHANNELS.entities.LINKS_CHANGED, { to: 'workspace', workspaceId }, workspaceId)
        return { ok: true, op: 'add', link }
      }
      case 'remove': {
        const removed = store.remove({ from: request.from, to: request.to, relation: request.relation })
        if (removed) pushTyped(server, RPC_CHANNELS.entities.LINKS_CHANGED, { to: 'workspace', workspaceId }, workspaceId)
        return { ok: true, op: 'remove', removed }
      }
      case 'outgoing':
        return { ok: true, op: 'outgoing', links: store.outgoing(request.ref) }
      case 'backlinks': {
        const page = store.backlinks(request.ref, {
          kinds: request.kinds,
          relations: request.relations,
          cursor: request.cursor,
          limit: request.limit,
        })
        return page.nextCursor
          ? { ok: true, op: 'backlinks', links: page.links, nextCursor: page.nextCursor }
          : { ok: true, op: 'backlinks', links: page.links }
      }
    }
  })

  server.handle(RPC_CHANNELS.entities.RESOLVE, async (ctx, workspaceId: string, input: unknown): Promise<EntityPreview[]> => {
    const request = entityResolveRequestSchema.parse(input)
    if (!isEnabled(runtime)) return request.refs.map(ref => unavailablePreview(ref))
    const previews = await hostForWorkspace(workspaceId).resolve(request.refs, actorFor(ctx))
    return previews.map(redactPreviewForWire)
  }, { nativeAction: 'read' })
}

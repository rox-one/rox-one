/**
 * W1-02 — Entity RPC handlers.
 *
 * `entities:links` is a single dispatcher over the local link store
 * (`op: add | remove | outgoing | backlinks`); `entities:resolve` resolves a
 * batch of refs into previews through the resolver host.
 *
 * Inert when off: gated by `isEntitiesLinksEnabled()` (default OFF). While the
 * flag is off no store is opened, nothing is written, `add`/`remove` report
 * `ok: false, reason: 'disabled'`, reads come back empty and resolution
 * returns no previews.
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
import type { Actor, EntityLink, EntityPreview, Resolver } from '@rox/core/entities'
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
 * One resolver host per process. Modules register their local resolvers via
 * `registerEntityResolver`; kinds without a resolver resolve to `unavailable`.
 */
const resolverHost = new DefaultResolverHost()

/** DI seam for owner modules (tasks, notes, goals, …) to serve local previews. */
export function registerEntityResolver(resolver: Resolver): void {
  resolverHost.register(resolver)
}

export function resetEntityResolvers(): void {
  resolverHost.clear()
}

export interface EntitiesHandlerRuntime {
  /** Host-provided workspace lookup (tests pass a fixed map). */
  workspaceFor?: (id: string) => { id: string; rootPath: string } | null
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
    if (!isEntitiesLinksEnabled()) {
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

  server.handle(RPC_CHANNELS.entities.RESOLVE, async (ctx, _workspaceId: string, input: unknown): Promise<EntityPreview[]> => {
    const request = entityResolveRequestSchema.parse(input)
    if (!isEntitiesLinksEnabled()) return []
    return resolverHost.resolve(request.refs, actorFor(ctx))
  }, { nativeAction: 'read' })
}
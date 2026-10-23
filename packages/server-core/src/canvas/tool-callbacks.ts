/**
 * Canvas entity-card tool callbacks (WP3.5).
 *
 * Backend for `canvas_create_entity_card` / `canvas_link_entity`. Uses the same
 * canvas-core board ops (`createEntityCard` / `linkEntityCard`) and entity-links
 * `embeds` convention as the surface UI. Preview snapshots are never written
 * into the Yjs doc (ENTITY_CARD_KEYS only).
 */
import {
  actorOrigin,
  createEntityCard,
  EntityKindRegistry,
  entityCards,
  linkEntityCard,
  type EntityCardContext,
  type EntityKindAdapter,
  type EntityLinker,
  type EntityRef,
} from '@rox/canvas-core'
import { isValidBoardId } from '@rox/canvas-core/node'
import type {
  CanvasCreateEntityCardInput,
  CanvasEntityCardResult,
  CanvasLinkEntityInput,
  CanvasToolCallbacks,
} from '@rox/session-tools-core'
import { isEntitiesLinksEnabled } from '@rox/shared/feature-flags'
import { getEntityLinkStore } from '../entities/link-store.ts'
import { getEntitiesWorkbenchFlags } from '../entities/workbench-flags.ts'
import { ensureCanvasLinksEnabled } from './links-ensure-host.ts'
import { canvasFileStoreFor } from './store-host.ts'

export type CanvasCreatableKind = 'note' | 'page' | 'dashboard' | 'session'

const CREATABLE = new Set<CanvasCreatableKind>(['note', 'page', 'dashboard', 'session'])

export class CanvasToolError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CanvasToolError'
    this.code = code
  }
}

export interface CanvasToolCallbacksDeps {
  workspaceId: string
  workspaceRootPath: string
  /** Agent session id — used as the Yjs actor origin. */
  sessionId: string
  /** Actor id recorded on embeds links (`createdBy`). */
  actorId: string
  /** Whether `workbench.mode.canvas.v1` is currently on (default ON). */
  isCanvasEnabled: () => boolean
  /** Edit access on the board (`edit` on `{ kind: 'canvas', id: boardId }`). */
  canEditBoard: (boardId: string) => boolean | Promise<boolean>
  /** View access on the target entity (link path). */
  canViewEntity: (ref: EntityRef) => boolean | Promise<boolean>
  /**
   * Mint a new entity through the kind's existing API. `dashboard` creates a
   * live page and must return `{ kind: 'page', id: slug }`.
   */
  createEntity: (input: {
    kind: CanvasCreatableKind
    title: string
    props?: Record<string, unknown>
    boardId: string
  }) => Promise<EntityRef>
  /**
   * Delete an entity minted for a card (orphan cleanup when link fails).
   * Required for create path; link path never deletes.
   */
  deleteEntity?: (ref: EntityRef) => void | Promise<void>
  /**
   * Enable `entities.links.v1` the same way the UI does when a card add hits
   * `disabled`. Default: process links-ensure host (Electron → durable flag).
   */
  ensureLinksEnabled?: () => void | Promise<void>
  /** Live workbench flag set for entities.links (tests inject a fixed set). */
  linksFlags?: () => ReadonlySet<string> | undefined
  log?: (message: string) => void
  /** After a successful place: flush + optional broadcast to open windows. */
  onBoardMutated?: (boardId: string) => void | Promise<void>
}

const DEFAULT_TITLE = 'Untitled'
const DEFAULT_AT = { x: 0, y: 0 }

function coded(code: string, message: string): never {
  throw new CanvasToolError(code, message)
}

function stubAdapter(
  kind: string,
  opts?: {
    create?: EntityKindAdapter['create']
    delete?: EntityKindAdapter['delete']
  },
): EntityKindAdapter {
  return {
    kind,
    labelKey: `entities.kind.${kind}`,
    icon: 'link',
    creatable: !!opts?.create,
    create: opts?.create,
    async read() { return null },
    open() {},
    delete: opts?.delete,
  }
}

function buildRegistry(
  createEntity: CanvasToolCallbacksDeps['createEntity'],
  deleteEntity?: CanvasToolCallbacksDeps['deleteEntity'],
): EntityKindRegistry {
  const registry = new EntityKindRegistry()
  for (const kind of CREATABLE) {
    registry.register(stubAdapter(kind, {
      create: async ({ title, boardId }) => createEntity({ kind, title, boardId }),
      delete: deleteEntity ? async (ref) => { await deleteEntity(ref) } : undefined,
    }))
  }
  return registry
}

function buildLinker(
  workspaceRoot: string,
  actorId: string,
  ensureLinks: () => void | Promise<void>,
  linksFlags: () => ReadonlySet<string> | undefined,
): EntityLinker {
  return {
    async link(from, to) {
      if (!isEntitiesLinksEnabled(linksFlags())) await ensureLinks()
      if (!isEntitiesLinksEnabled(linksFlags())) {
        coded('CANVAS_LINKS_DISABLED', 'entity links are disabled')
      }
      getEntityLinkStore(workspaceRoot).add({
        from: { kind: 'canvas', id: from.boardId, fragment: from.objectId },
        to: { kind: to.kind, id: to.id },
        relation: 'embeds',
        createdBy: actorId,
      })
    },
    async unlink(from, to) {
      if (!isEntitiesLinksEnabled(linksFlags())) return
      getEntityLinkStore(workspaceRoot).remove({
        from: { kind: 'canvas', id: from.boardId, fragment: from.objectId },
        to: { kind: to.kind, id: to.id },
        relation: 'embeds',
      })
    },
  }
}

export function buildCanvasToolCallbacks(deps: CanvasToolCallbacksDeps): CanvasToolCallbacks {
  const ensureLinks = deps.ensureLinksEnabled ?? ensureCanvasLinksEnabled
  const linksFlags = deps.linksFlags ?? (() => getEntitiesWorkbenchFlags())
  const origin = actorOrigin('agent', deps.sessionId)

  async function prepareBoard(boardId: string): Promise<EntityCardContext> {
    if (!deps.isCanvasEnabled()) coded('CANVAS_DISABLED', 'workbench.mode.canvas.v1 is off')
    if (!isValidBoardId(boardId)) coded('CANVAS_BAD_BOARD', `invalid board id: ${boardId}`)
    if (!(await deps.canEditBoard(boardId))) {
      coded('CANVAS_FORBIDDEN', 'edit access denied on this board')
    }
    const store = canvasFileStoreFor(deps.workspaceRootPath)
    const boards = await store.listBoards()
    if (!boards.some(b => b.id === boardId)) {
      coded('CANVAS_BOARD_MISSING', `board not found: ${boardId}`)
    }
    const board = await store.openBoard(boardId)
    return {
      board,
      boardId,
      workspaceId: deps.workspaceId,
      registry: buildRegistry(deps.createEntity, deps.deleteEntity),
      linker: buildLinker(deps.workspaceRootPath, deps.actorId, ensureLinks, linksFlags),
      origin,
    }
  }

  async function finish(boardId: string, objectId: string, entityId: string): Promise<CanvasEntityCardResult> {
    await canvasFileStoreFor(deps.workspaceRootPath).flush(boardId).catch(() => {})
    await deps.onBoardMutated?.(boardId)
    deps.log?.(`canvas tool: placed card ${objectId} → ${entityId} on board ${boardId}`)
    return { objectId, entityId, boardId }
  }

  function atOf(input: { x?: number; y?: number }) {
    return {
      x: typeof input.x === 'number' && Number.isFinite(input.x) ? input.x : DEFAULT_AT.x,
      y: typeof input.y === 'number' && Number.isFinite(input.y) ? input.y : DEFAULT_AT.y,
    }
  }

  return {
    async createEntityCard(input: CanvasCreateEntityCardInput): Promise<CanvasEntityCardResult> {
      const kind = input.kind.trim() as CanvasCreatableKind
      if (!CREATABLE.has(kind)) coded('CANVAS_KIND_NOT_CREATABLE', `entity kind not creatable: ${kind}`)
      const ctx = await prepareBoard(input.boardId)
      const title = input.title?.trim() || DEFAULT_TITLE
      // Pass props through create by wrapping the registry create once.
      if (input.props && Object.keys(input.props).length) {
        const base = ctx.registry.get(kind)!
        const prev = base.create!
        base.create = async (args) => deps.createEntity({
          kind,
          title: args.title,
          props: input.props,
          boardId: args.boardId,
        })
        try {
          const objectId = await createEntityCard(ctx, kind, title, atOf(input))
          const card = entityCards(ctx.board).find(c => c.objectId === objectId)
          if (!card) coded('CANVAS_INTERNAL', 'card missing after create')
          return finish(input.boardId, objectId, card.ref.id)
        } finally {
          base.create = prev
        }
      }
      const objectId = await createEntityCard(ctx, kind, title, atOf(input))
      const card = entityCards(ctx.board).find(c => c.objectId === objectId)
      if (!card) coded('CANVAS_INTERNAL', 'card missing after create')
      return finish(input.boardId, objectId, card.ref.id)
    },

    async linkEntity(input: CanvasLinkEntityInput): Promise<CanvasEntityCardResult> {
      const kind = input.kind.trim()
      const entityId = input.entityId.trim()
      if (!kind || !entityId) coded('CANVAS_BAD_ENTITY', 'kind and entityId are required')
      const ctx = await prepareBoard(input.boardId)
      const ref: EntityRef = { kind, id: entityId }
      if (!(await deps.canViewEntity(ref))) {
        coded('CANVAS_FORBIDDEN', 'view access denied on this entity')
      }
      if (!ctx.registry.get(kind)) ctx.registry.register(stubAdapter(kind))
      const objectId = await linkEntityCard(ctx, ref, atOf(input))
      return finish(input.boardId, objectId, entityId)
    },
  }
}

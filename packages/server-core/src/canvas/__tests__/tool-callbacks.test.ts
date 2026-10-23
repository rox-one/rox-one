/**
 * WP3.5 — canvas entity-card tool callbacks: happy path, denied access, missing board.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { entityCards } from '@rox/canvas-core'
import { CanvasFileStore } from '@rox/canvas-core/node'
import { ENTITIES_LINKS_WORKBENCH_FLAG } from '@rox/shared/feature-flags'
import { closeEntityLinkStores, getEntityLinkStore } from '../../entities/link-store.ts'
import {
  resetEntitiesWorkbenchFlags,
  setEntitiesWorkbenchFlags,
} from '../../entities/workbench-flags.ts'
import { resetCanvasFileStoreHost, setCanvasFileStoreHost } from '../store-host.ts'
import { resetCanvasLinksEnsureHost, setCanvasLinksEnsureHost } from '../links-ensure-host.ts'
import { buildCanvasToolCallbacks, CanvasToolError } from '../tool-callbacks.ts'

const dirs: string[] = []
afterEach(async () => {
  closeEntityLinkStores()
  resetCanvasFileStoreHost()
  resetCanvasLinksEnsureHost()
  resetEntitiesWorkbenchFlags()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function fixture(opts?: {
  canEditBoard?: boolean
  canViewEntity?: boolean
  canvasEnabled?: boolean
}) {
  const root = mkdtempSync(join(tmpdir(), 'canvas-tool-'))
  dirs.push(root)
  setEntitiesWorkbenchFlags([ENTITIES_LINKS_WORKBENCH_FLAG])
  // One store per root (lock): register it as the process host before createBoard.
  const store = new CanvasFileStore(root)
  setCanvasFileStoreHost({ forRoot: (r) => { if (r !== root) throw new Error('unexpected root'); return store } })
  const board = await store.createBoard('Test board')
  let created = 0
  const deleted: Array<{ kind: string; id: string }> = []
  const canvas = buildCanvasToolCallbacks({
    workspaceId: 'ws-1',
    workspaceRootPath: root,
    sessionId: 'session-1',
    actorId: 'agent:session-1',
    isCanvasEnabled: () => opts?.canvasEnabled !== false,
    canEditBoard: async () => opts?.canEditBoard !== false,
    canViewEntity: async () => opts?.canViewEntity !== false,
    createEntity: async ({ kind, title }) => {
      created += 1
      const id = kind === 'page' || kind === 'dashboard' ? `slug-${created}` : `ent-${created}`
      return { kind: kind === 'dashboard' ? 'page' : kind, id: `${id}:${title}` }
    },
    deleteEntity: async (ref) => { deleted.push({ kind: ref.kind, id: ref.id }) },
  })
  return { root, board, canvas, store, deleted }
}

describe('buildCanvasToolCallbacks', () => {
  test('happy path: createEntityCard places a created card and writes embeds link', async () => {
    const f = await fixture()
    const result = await f.canvas.createEntityCard({
      boardId: f.board.id,
      kind: 'note',
      title: 'From agent',
      x: 40,
      y: 80,
    })
    expect(result.boardId).toBe(f.board.id)
    expect(result.entityId).toContain('From agent')
    expect(result.objectId).toBeTruthy()

    const doc = await f.store.openBoard(f.board.id)
    const cards = entityCards(doc)
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      objectId: result.objectId,
      ref: { kind: 'note', id: result.entityId },
    })
    const obj = doc.list().find(o => o.id === result.objectId)
    expect(obj?.props).toMatchObject({ kind: 'note', entityId: result.entityId, origin: 'created' })
    expect(obj?.props).not.toHaveProperty('snapshot')
    expect(obj?.props).not.toHaveProperty('title')

    const links = getEntityLinkStore(f.root).outgoing({
      kind: 'canvas', id: f.board.id, fragment: result.objectId,
    })
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      relation: 'embeds',
      to: { kind: 'note', id: result.entityId },
      createdBy: 'agent:session-1',
    })
  })

  test('happy path: linkEntity places a linked card for an existing entity', async () => {
    const f = await fixture()
    const result = await f.canvas.linkEntity({
      boardId: f.board.id,
      kind: 'session',
      entityId: 'sess-9',
      x: 1,
      y: 2,
    })
    expect(result).toEqual({
      objectId: result.objectId,
      entityId: 'sess-9',
      boardId: f.board.id,
    })
    const doc = await f.store.openBoard(f.board.id)
    const obj = doc.list().find(o => o.id === result.objectId)
    expect(obj?.props).toMatchObject({ kind: 'session', entityId: 'sess-9', origin: 'linked' })
  })

  test('denied access: canEditBoard false → CANVAS_FORBIDDEN', async () => {
    const f = await fixture({ canEditBoard: false })
    try {
      await f.canvas.createEntityCard({ boardId: f.board.id, kind: 'note', title: 'x' })
      expect(true).toBe(false)
    } catch (e) {
      expect(e).toBeInstanceOf(CanvasToolError)
      expect((e as CanvasToolError).code).toBe('CANVAS_FORBIDDEN')
    }
  })

  test('denied access: canViewEntity false on link → CANVAS_FORBIDDEN', async () => {
    const f = await fixture({ canViewEntity: false })
    try {
      await f.canvas.linkEntity({ boardId: f.board.id, kind: 'note', entityId: 'n1' })
      expect(true).toBe(false)
    } catch (e) {
      expect(e).toBeInstanceOf(CanvasToolError)
      expect((e as CanvasToolError).code).toBe('CANVAS_FORBIDDEN')
    }
  })

  test('missing board → CANVAS_BOARD_MISSING', async () => {
    const f = await fixture()
    try {
      await f.canvas.createEntityCard({ boardId: 'no-such-board', kind: 'note', title: 'x' })
      expect(true).toBe(false)
    } catch (e) {
      expect(e).toBeInstanceOf(CanvasToolError)
      expect((e as CanvasToolError).code).toBe('CANVAS_BOARD_MISSING')
    }
  })

  test('canvas flag off → CANVAS_DISABLED', async () => {
    const f = await fixture({ canvasEnabled: false })
    try {
      await f.canvas.linkEntity({ boardId: f.board.id, kind: 'note', entityId: 'n1' })
      expect(true).toBe(false)
    } catch (e) {
      expect(e).toBeInstanceOf(CanvasToolError)
      expect((e as CanvasToolError).code).toBe('CANVAS_DISABLED')
    }
  })

  test('ensureLinksEnabled host is used when links start disabled', async () => {
    resetEntitiesWorkbenchFlags()
    let ensured = 0
    setCanvasLinksEnsureHost(() => {
      ensured += 1
      setEntitiesWorkbenchFlags([ENTITIES_LINKS_WORKBENCH_FLAG])
    })
    const f = await fixture()
    resetEntitiesWorkbenchFlags()
    const result = await f.canvas.linkEntity({ boardId: f.board.id, kind: 'note', entityId: 'n1' })
    expect(result.objectId).toBeTruthy()
    expect(ensured).toBeGreaterThanOrEqual(1)
  })

  test('task is not creatable (link-only)', async () => {
    const f = await fixture()
    try {
      await f.canvas.createEntityCard({ boardId: f.board.id, kind: 'task', title: 't' })
      expect(true).toBe(false)
    } catch (e) {
      expect(e).toBeInstanceOf(CanvasToolError)
      expect((e as CanvasToolError).code).toBe('CANVAS_KIND_NOT_CREATABLE')
    }
  })
})


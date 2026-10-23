/**
 * WP3.2 — canvas embed backlink shape, label, and navigation helpers.
 */
import { describe, expect, it } from 'bun:test'
import type { EntityLink } from '@rox/core/entities'
import { entityRoute, parseEntityRoute } from '@rox/core/entities'
import {
  canvasBacklinkBoardRef,
  canvasBacklinkOpenRef,
  canvasBacklinkRoute,
  formatOnBoardBacklinkLabel,
  isCanvasEmbedBacklink,
} from '../canvas-backlink'
import { backlinkGroupOf, groupBacklinks } from '../backlink-groups'
import { parseCanvasRoute } from '@/pages/canvas/canvas-target'

function link(from: EntityLink['from'], relation: EntityLink['relation'] = 'embeds'): EntityLink {
  return {
    linkId: 'l1',
    from,
    to: { kind: 'note', id: 'n1' },
    relation,
    createdBy: 'u1',
    createdAt: '2026-10-23T00:00:00.000Z',
    revision: 1,
  }
}

describe('canvas embed link shape (WP3.2)', () => {
  it('recognises board→entity embeds with object fragment', () => {
    const l = link({ kind: 'canvas', id: 'board-1', fragment: 'obj-9' })
    expect(isCanvasEmbedBacklink(l)).toBe(true)
    expect(isCanvasEmbedBacklink(link({ kind: 'note', id: 'n2' }, 'embeds'))).toBe(false)
    expect(isCanvasEmbedBacklink(link({ kind: 'canvas', id: 'board-1', fragment: 'obj-9' }, 'mentions'))).toBe(false)
  })

  it('open ref keeps the card fragment; board ref drops it for title cache', () => {
    const l = link({ kind: 'canvas', id: 'board-1', fragment: 'obj-9' })
    expect(canvasBacklinkOpenRef(l)).toEqual({ kind: 'canvas', id: 'board-1', fragment: 'obj-9' })
    expect(canvasBacklinkBoardRef(l)).toEqual({ kind: 'canvas', id: 'board-1' })
  })

  it('groups canvas under boards', () => {
    expect(backlinkGroupOf('canvas')).toBe('boards')
    const groups = groupBacklinks([link({ kind: 'canvas', id: 'b1', fragment: 'o1' })])
    expect(groups.map((g) => g.group)).toEqual(['boards'])
    expect(groups[0]!.sources).toHaveLength(1)
  })
})

describe('«На доске …» label + navigation helper', () => {
  const t = ((key: string, opts?: { title?: string }) => {
    if (key === 'entities.ui.backlinks.onBoard') return `На доске ${opts?.title ?? ''}`
    if (key === 'entities.kind.canvas') return 'Доска'
    return key
  }) as never

  it('formats On board / На доске with title; falls back to kind label', () => {
    expect(formatOnBoardBacklinkLabel(t, 'Sprint')).toBe('На доске Sprint')
    expect(formatOnBoardBacklinkLabel(t, '  ')).toBe('На доске Доска')
  })

  it('route + parse round-trip focuses the object fragment', () => {
    const ref = { kind: 'canvas' as const, id: 'board-1', fragment: 'obj-9' }
    const route = canvasBacklinkRoute(ref)
    expect(route).toBe('canvas/board/board-1#obj-9')
    expect(entityRoute(ref)).toBe(route)
    const parsed = parseEntityRoute(route)
    expect(parsed?.ref).toEqual(ref)
    expect(parseCanvasRoute(route)).toEqual({ boardId: 'board-1', objectId: 'obj-9' })
    expect(parseCanvasRoute('canvas/board/board-1')).toEqual({ boardId: 'board-1' })
  })
})

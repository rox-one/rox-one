/**
 * WP3.2 — canvas embed backlinks («На доске …»).
 *
 * Board → entity links are written as
 *   from: { kind: 'canvas', id: boardId, fragment: objectId }
 *   relation: 'embeds'
 * so the entity's backlinks panel can open the exact card.
 * Pure helpers only — UI and navigation reuse BacklinksPanel / openEntity.
 */
import type { TFunction } from 'i18next'
import type { EntityLink, EntityRef } from '@rox/core/entities'

/** True when this link is a board card embed (canvas → entity via `embeds`). */
export function isCanvasEmbedBacklink(link: Pick<EntityLink, 'from' | 'relation'>): boolean {
  return link.from.kind === 'canvas' && link.relation === 'embeds' && !!link.from.id
}

/**
 * Ref used to open the board (and focus the card when `fragment` is set).
 * Same shape `openEntity` / `setCanvasTarget` already understand.
 */
export function canvasBacklinkOpenRef(link: Pick<EntityLink, 'from'>): EntityRef {
  const { id, fragment } = link.from
  return fragment ? { kind: 'canvas', id, fragment } : { kind: 'canvas', id }
}

/** Board-only ref (no fragment) so title previews cache per board, not per card. */
export function canvasBacklinkBoardRef(link: Pick<EntityLink, 'from'>): EntityRef {
  return { kind: 'canvas', id: link.from.id }
}

/** Localised «На доске {title}» / "On board {title}". */
export function formatOnBoardBacklinkLabel(t: TFunction, title: string): string {
  const trimmed = title.trim()
  return t('entities.ui.backlinks.onBoard', { title: trimmed || t('entities.kind.canvas') })
}

/** Parse `canvas/board/{id}[#objectId]` for navigation tests (mirrors canvas-target). */
export function canvasBacklinkRoute(ref: EntityRef): string {
  if (ref.kind !== 'canvas') throw new Error(`not a canvas ref: ${ref.kind}`)
  const base = `canvas/board/${encodeURIComponent(ref.id)}`
  return ref.fragment ? `${base}#${encodeURIComponent(ref.fragment)}` : base
}

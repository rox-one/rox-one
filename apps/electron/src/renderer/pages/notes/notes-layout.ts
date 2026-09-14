import type { NotesRailLayout } from './document-ia'

export type NotesRail = 'vault' | 'toc' | 'comments'

/** Leave a readable document in every workspace tile. Saved widths are never rewritten by resizing. */
export function visibleNotesRails(layout: NotesRailLayout, width: number, documentView = true): Record<NotesRail, boolean> {
  let remaining = Math.max(0, width - 360)
  const visible = { vault: false, toc: false, comments: false }
  for (const rail of ['vault', 'comments', 'toc'] as const) {
    if (layout[`${rail}Collapsed`] || (rail !== 'vault' && !documentView)) continue
    if (remaining >= layout[rail]) {
      visible[rail] = true
      remaining -= layout[rail]
    }
  }
  return visible
}

export function notesRailKeyWidth(width: number, key: string, invert = false, shift = false): number | null {
  if (key === 'Home') return 140
  if (key === 'End') return 480
  const direction = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0
  if (!direction) return null
  return Math.max(140, Math.min(480, width + direction * (invert ? -1 : 1) * (shift ? 40 : 10)))
}

export function maximumNotesRailWidth(rail: NotesRail, layout: NotesRailLayout, width: number, visible: Record<NotesRail, boolean>): number {
  const occupied = (['vault', 'toc', 'comments'] as const)
    .filter((other) => other !== rail && visible[other])
    .reduce((sum, other) => sum + layout[other], 0)
  return Math.max(140, Math.min(480, width - 360 - occupied))
}

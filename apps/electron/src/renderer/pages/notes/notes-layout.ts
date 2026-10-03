export function notesRailKeyWidth(width: number, key: string, invert = false, shift = false): number | null {
  if (key === 'Home') return 140
  if (key === 'End') return 480
  const direction = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0
  if (!direction) return null
  return Math.max(140, Math.min(480, width + direction * (invert ? -1 : 1) * (shift ? 40 : 10)))
}


/** Keep the current Notes460px document budget before showing its actual auxiliary owners. */
export function notesAuxiliaryFits(width: number, inspectorCollapsed: boolean, sessionOpen: boolean): boolean {
  if (!Number.isFinite(width) || width <= 0) return true // initial/retained measurement
  return width >= 460 + (inspectorCollapsed ? 32 : 320) + (sessionOpen ? 380 : 0)
}

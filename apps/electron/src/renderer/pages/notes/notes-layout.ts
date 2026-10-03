export function notesRailKeyWidth(width: number, key: string, invert = false, shift = false): number | null {
  if (key === 'Home') return 140
  if (key === 'End') return 480
  const direction = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0
  if (!direction) return null
  return Math.max(140, Math.min(480, width + direction * (invert ? -1 : 1) * (shift ? 40 : 10)))
}


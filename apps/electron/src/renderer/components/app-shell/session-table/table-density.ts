import type { CollectionDensity } from '@craft-agent/shared/sessions/collection'

/** Compact ≈ current 40px rows; comfortable adds vertical padding. */
export function collectionTableRowHeight(density: CollectionDensity | undefined): number {
  return density === 'comfortable' ? 48 : 36
}

export function collectionTableRowClass(density: CollectionDensity | undefined): string {
  return density === 'comfortable' ? 'min-h-12 py-2.5' : 'min-h-8 py-1'
}

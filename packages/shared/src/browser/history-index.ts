import type { IndexedItem } from './profile-import.ts'

export interface HistoryIndexIo {
  read: () => IndexedItem[]
  write: (rows: IndexedItem[]) => void
}

/** Append only rows newer than the watermark (by url identity). 0 new → 0 writes. */
export function appendHistoryIndex(
  io: HistoryIndexIo,
  incoming: readonly IndexedItem[],
): { appended: number; wrote: boolean } {
  if (incoming.length === 0) return { appended: 0, wrote: false }
  const existing = io.read()
  const seen = new Set(existing.map((row) => row.url))
  const added = incoming.filter((row) => !seen.has(row.url))
  if (added.length === 0) return { appended: 0, wrote: false }
  io.write([...existing, ...added])
  return { appended: added.length, wrote: true }
}

export function nextHistoryWatermark(current: number | undefined, timestamps: readonly number[]): number | undefined {
  let max = current
  for (const value of timestamps) {
    if (!Number.isFinite(value)) continue
    if (max === undefined || value > max) max = value
  }
  return max
}

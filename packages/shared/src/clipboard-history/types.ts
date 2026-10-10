/**
 * Rox History (clipboard history) DTOs — shared between the Electron main
 * clipboard store/monitor and the renderer UI. Browser-safe: types and tiny
 * pure helpers only, no node imports.
 */

export type ClipEntryKind = 'text' | 'image'

/** Stored image formats; other decoded MIME types (webp/tiff) are never captured. */
export type ClipImageFormat = 'png' | 'gif' | 'jpg'

export interface ClipEntrySummary {
  id: number
  kind: ClipEntryKind
  preview: string
  text: string | null
  charCount: number | null
  imageFormat: ClipImageFormat | null
  imageWidth: number | null
  imageHeight: number | null
  imageByteSize: number | null
  thumbDataUrl: string | null
  tags: string[]
  starred: boolean
  createdAt: string
  sourceApp: string | null
}

export interface ClipEntryDetail extends ClipEntrySummary {
  imageDataUrl: string | null
}

export interface ClipCounts {
  total: number
  starred: number
  text: number
  image: number
}

export interface ClipListQuery {
  q?: string
  kind?: ClipEntryKind | 'all'
  /**
   * Restrict to a single stored image format. Only image entries carry a format;
   * `'all'` and `undefined` both mean "no format filter".
   */
  format?: ClipImageFormat | 'all'
  starredOnly?: boolean
  tag?: string
  limit?: number
  offset?: number
}

export interface ClipListResult {
  entries: ClipEntrySummary[]
  total: number
  counts: ClipCounts
  hasMore: boolean
}

export interface ClipTagCount {
  tag: string
  count: number
}

export interface ClipSettings {
  captureEnabled: boolean
  captureImages: boolean
  retentionDays: number
  maxEntries: number
  hideSensitive: boolean
  globalShortcutEnabled: boolean
  globalShortcut: string
}

export interface ClipStats {
  total: number
  starred: number
  text: number
  image: number
  bytes: number
  storageBytes: number
  oldestAt: string | null
}

export interface ClipChangedPayload {
  reason: 'captured' | 'updated' | 'cleared' | 'settings'
}
/**
 * Shared asset id / MIME / size rules for «Доска» blobs.
 * Used by the isomorphic doc/schema and by the node asset store (no Node APIs here).
 */
export const ASSET_HASH_RE = /^[a-f0-9]{64}$/
export const MAX_ASSET_BYTES = 25 * 1024 * 1024

const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/svg+xml',
])

export function isValidAssetHash(h: string): boolean {
  return ASSET_HASH_RE.test(h)
}

/** Lowercase allowlisted MIME, or null. `image/jpg` → `image/jpeg`. */
export function normalizeAssetMime(mime: unknown): string | null {
  if (typeof mime !== 'string') return null
  const m = mime.trim().toLowerCase().split(';', 1)[0]!.trim()
  if (!ALLOWED_MIME.has(m)) return null
  return m === 'image/jpg' ? 'image/jpeg' : m
}

export function sanitizeAssetName(name: unknown): string {
  if (typeof name !== 'string') return 'image'
  const base = name.replace(/[/\\<>:"|?*\x00-\x1f]/g, '_').trim().slice(0, 200)
  return base || 'image'
}

/**
 * Static-file URL path resolution shared by the WebUI HTTP handler and the
 * media-ticket module. Kept in its own module so neither importer depends on
 * the other (avoids an import cycle).
 */

import { resolve } from 'node:path'
import { isPathInsideBase } from '../utils/path-validation'

/**
 * Resolve a URL path to a file inside `baseDir`. Rejects traversal, absolute
 * segments, and NUL bytes so `/login-assets/../…` cannot read the host.
 */
export function resolveWebuiFile(baseDir: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  const trimmed = decoded.split('?')[0]?.split('#')[0] ?? ''
  if (!trimmed || trimmed.includes('\0')) return null
  const relative = trimmed.replace(/^\/+/, '')
  if (!relative) return null
  const resolved = resolve(baseDir, relative)
  if (!isPathInsideBase(resolved, baseDir)) return null
  return resolved
}
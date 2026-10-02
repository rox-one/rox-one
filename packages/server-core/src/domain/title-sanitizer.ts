/**
 * Title sanitization utility.
 * Extracted to a separate file to allow unit testing without importing
 * Electron main process modules.
 */
import { replacePathMentions, WS_ID_CHARS } from '@craft-agent/shared/mentions'

/** Non-nesting, leftmost delimiter stripping matching the historical regex grammar. */
function stripDelimited(text: string, open: string, close: string, nonempty: boolean): string {
  const parts: string[] = []
  let cursor = 0
  let search = 0
  while (search < text.length) {
    const start = text.indexOf(open, search)
    if (start < 0) break
    const valueStart = start + open.length
    const end = text.indexOf(close, valueStart)
    if (end < 0) break
    search = end + close.length
    if (nonempty && end === valueStart) continue
    parts.push(text.slice(cursor, start))
    cursor = search
  }
  parts.push(text.slice(cursor))
  return parts.join('')
}

/**
 * Sanitize message content for use as session title.
 * Strips XML blocks (e.g. <edit_request>), bracket mentions, and normalizes whitespace.
 */
export function sanitizeForTitle(content: string): string {
  const withoutTags = stripDelimited(stripDelimited(content, '<edit_request>', '</edit_request>', false), '<', '>', true)
  const withoutReferences = withoutTags
    .replace(new RegExp(`\\[skill:(?:${WS_ID_CHARS}+:)?[\\w-]+\\]`, 'g'), '')   // Strip [skill:...] mentions
    .replace(/\[source:[\w-]+\]/g, '')
  const withoutFiles = replacePathMentions(withoutReferences, 'file', () => '')
  const withoutPaths = replacePathMentions(withoutFiles, 'folder', () => '')
  return withoutPaths
    .replace(/\s+/g, ' ')        // Collapse whitespace
    .trim()
}

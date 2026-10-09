/**
 * W1-14 (#1511) — Comment anchors on Yjs relative positions (TECH-SPEC §11.3).
 *
 * A comment thread is anchored to a range of a shared doc by two **relative
 * positions**: `Y.createRelativePositionFromTypeIndex` on encode and
 * `Y.createAbsolutePositionFromRelativePosition` on load. That is what makes
 * an anchor survive concurrent edits — a plain index would drift as soon as
 * anyone types above the thread.
 *
 * On the wire and in `comment.anchor` (jsonb) the two positions are base64 of
 * the Yjs encoding, next to a `quote` and a `blockId` fallback for the case
 * where the text the thread pointed at was deleted.
 *
 * `@rox/core` has no dependency on `yjs`: this module owns the *codec* (the
 * base64 envelope) and the fallback rules; the yjs calls around it are the
 * editor's. `packages/core/src/collab/__tests__/anchor.yjs.test.ts` runs the
 * round-trip against real yjs replicas.
 */

export interface YAnchor {
  /** base64 of `Y.encodeRelativePosition(start)` — the range start. */
  start: string
  /** base64 of `Y.encodeRelativePosition(end)`. */
  end: string
  /** The text the thread was created on, for a deleted-anchor fallback. */
  quote?: string
  /** Block the thread was created in, for the fallback scroll target. */
  blockId?: string
}

/** `anchor.quote` is an excerpt, never a copy of the paragraph. */
export const ANCHOR_QUOTE_MAX = 200

/** Both sides resolve to the same absolute index → the anchored text is gone. */
export function anchorIsCollapsed(startIndex: number, endIndex: number): boolean {
  return startIndex === endIndex
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** RFC 4648 base64 (with padding) of a byte array; dependency- and runtime-free. */
export function encodeBase64(bytes: Uint8Array): string {
  let out = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0
    const b = bytes[index + 1]
    const c = bytes[index + 2]
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += BASE64_ALPHABET[(triple >> 18) & 0x3f]
    out += BASE64_ALPHABET[(triple >> 12) & 0x3f]
    out += b === undefined ? '=' : BASE64_ALPHABET[(triple >> 6) & 0x3f]
    out += c === undefined ? '=' : BASE64_ALPHABET[triple & 0x3f]
  }
  return out
}

/** Decode RFC 4648 base64; `null` for anything malformed (never throws). */
export function decodeBase64(text: string): Uint8Array | null {
  if (typeof text !== 'string') return null
  const trimmed = text.endsWith('==') ? text.slice(0, -2) : text.endsWith('=') ? text.slice(0, -1) : text
  if (trimmed.length === 0) return new Uint8Array(0)
  if (trimmed.length % 4 === 1) return null
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of trimmed) {
    const value = BASE64_ALPHABET.indexOf(char)
    if (value === -1) return null
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  if (bits >= 6) return null
  if ((buffer & ((1 << bits) - 1)) !== 0) return null
  return new Uint8Array(bytes)
}

/** Build the stored anchor from the two encoded relative positions. */
export function encodeYAnchor(
  start: Uint8Array,
  end: Uint8Array,
  options: { quote?: string; blockId?: string } = {},
): YAnchor {
  const anchor: YAnchor = { start: encodeBase64(start), end: encodeBase64(end) }
  if (options.quote) anchor.quote = options.quote.slice(0, ANCHOR_QUOTE_MAX)
  if (options.blockId) anchor.blockId = options.blockId
  return anchor
}

/** Decode a stored anchor; `null` when either side is malformed or absent. */
export function decodeYAnchor(anchor: YAnchor): { start: Uint8Array; end: Uint8Array } | null {
  const start = decodeBase64(anchor?.start ?? '')
  const end = decodeBase64(anchor?.end ?? '')
  return start && end ? { start, end } : null
}

/** Whether an anchor is usable at all (both sides present, valid base64). */
export function isUsableAnchor(anchor: unknown): anchor is YAnchor {
  if (!anchor || typeof anchor !== 'object') return false
  return decodeYAnchor(anchor as YAnchor) !== null
}

/**
 * The state of a thread after its anchor was resolved against the current doc
 * (TECH-SPEC §11.3): a collapsed range means the text is gone, and the thread
 * is shown on its `quote` instead.
 */
export type AnchorResolution = 'resolved' | 'deleted'

export function anchorResolution(startIndex: number, endIndex: number): AnchorResolution {
  return anchorIsCollapsed(startIndex, endIndex) ? 'deleted' : 'resolved'
}
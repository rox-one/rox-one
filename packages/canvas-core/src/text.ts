/** String hygiene shared by the board model (UTF-16 safety). */

/** Replace lone surrogates with U+FFFD: Yjs encodes UTF-8, so a lone surrogate would decode differently on peers. */
export function wellFormed(s: string): string {
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD')
}

/** Cut to at most `max` UTF-16 units without splitting a surrogate pair. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s
  let end = max
  const c = s.charCodeAt(end - 1)
  if (c >= 0xd800 && c <= 0xdbff) end--
  return s.slice(0, end)
}

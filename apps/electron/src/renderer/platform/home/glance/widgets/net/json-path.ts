/** Tiny, safe JSON path: `a.b[0].c` / `items.0.name`. No eval, no prototype keys. */
export function getPath(root: unknown, path: string): unknown {
  const parts = path.trim().replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  if (parts.length > 20) return undefined
  let cur: unknown = root
  for (const p of parts) {
    if (p === '__proto__' || p === 'constructor' || p === 'prototype') return undefined
    if (Array.isArray(cur)) cur = /^\d+$/.test(p) ? cur[Number(p)] : p === 'length' ? cur.length : undefined
    else if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, p)) cur = (cur as Record<string, unknown>)[p]
    else return undefined
  }
  return cur
}

/** "Label = path" lines → pairs; a bare path is its own label. */
export function parseFieldSpecs(lines: unknown): { label: string; path: string }[] {
  return (Array.isArray(lines) ? lines : [])
    .filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
    .slice(0, 30)
    .map((l) => {
      const i = l.indexOf('=')
      return i > 0 ? { label: l.slice(0, i).trim().slice(0, 60), path: l.slice(i + 1).trim() } : { label: l.trim().slice(0, 60), path: l.trim() }
    })
}

export function display(value: unknown, locale: string): string {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'number') return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value)
  if (typeof value === 'string') return value.slice(0, 300)
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  try { return JSON.stringify(value).slice(0, 300) } catch { return '—' }
}

/** Stable 32-bit FNV-1a hash (change detection). */
export function hashText(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Visible text of an HTML page (scripts/styles/tags/whitespace dropped). */
export function pageText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

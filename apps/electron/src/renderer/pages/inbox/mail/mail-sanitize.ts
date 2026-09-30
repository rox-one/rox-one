/**
 * Mail HTML hardening for the reading pane. Two layers:
 *  1. DOM sanitizer (allow-list of tags/attributes; no scripts, forms,
 *     frames, event handlers or javascript:/data: links; remote images are
 *     blocked until the user allows them).
 *  2. The result is shown in a sandboxed iframe (no allow-scripts, no
 *     same-origin) with a CSP that forbids scripts and remote loads.
 */

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'center', 'code', 'col', 'colgroup', 'dd', 'del', 'div', 'dl', 'dt',
  'em', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q',
  's', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'tt', 'u', 'ul',
])
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'base', 'svg', 'math', 'noscript', 'template', 'frame', 'frameset', 'applet', 'audio', 'video', 'canvas', 'title', 'head'])
const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'align', 'valign', 'colspan', 'rowspan', 'cellpadding', 'cellspacing', 'border', 'bgcolor', 'color', 'face', 'size', 'style', 'dir', 'lang'])

export interface SanitizedMail {
  html: string
  blockedImages: number
}

function safeUrl(value: string, kind: 'href' | 'src', allowImages: boolean): string | null {
  const v = value.trim()
  if (/^(javascript|vbscript|file):/i.test(v)) return null
  if (kind === 'href') return /^(https?:|mailto:|#)/i.test(v) ? v : null
  if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(v)) return v
  if (/^https?:/i.test(v)) return allowImages ? v : null
  return null
}

function cleanStyle(style: string): string {
  return style
    .replace(/expression\s*\(/gi, '')
    .replace(/url\s*\([^)]*\)/gi, 'none')
    .replace(/position\s*:\s*(fixed|absolute)/gi, 'position:static')
    .replace(/behavior\s*:/gi, '')
}

export function sanitizeMailHtml(html: string, opts: { allowImages: boolean }): SanitizedMail {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let blockedImages = 0
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase()
      if (DROP_WITH_CONTENT.has(tag)) {
        child.remove()
        continue
      }
      if (!ALLOWED_TAGS.has(tag)) {
        walk(child)
        child.replaceWith(...Array.from(child.childNodes))
        continue
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase()
        if (!ALLOWED_ATTRS.has(name)) {
          child.removeAttribute(attr.name)
          continue
        }
        if (name === 'href' || name === 'src') {
          const url = safeUrl(attr.value, name, opts.allowImages)
          if (!url) {
            if (tag === 'img' && name === 'src' && /^https?:/i.test(attr.value.trim())) blockedImages++
            child.removeAttribute(attr.name)
          } else child.setAttribute(attr.name, url)
        } else if (name === 'style') {
          child.setAttribute('style', cleanStyle(attr.value))
        }
      }
      if (tag === 'a') {
        child.setAttribute('target', '_blank')
        child.setAttribute('rel', 'noopener noreferrer')
      }
      if (tag === 'img' && !child.getAttribute('src')) {
        child.setAttribute('alt', child.getAttribute('alt') || '')
      }
      walk(child)
    }
  }
  walk(doc.body)
  return { html: doc.body.innerHTML, blockedImages }
}

/** Complete srcdoc for the sandboxed iframe: CSP + a neutral light "paper" look. */
export function mailSrcdoc(bodyHtml: string, opts: { allowImages: boolean }): string {
  const img = opts.allowImages ? 'data: https: http:' : 'data:'
  const csp = `default-src 'none'; img-src ${img}; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'`
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><style>
html,body{margin:0;padding:0;background:#fff;color:#111}
body{padding:16px;font:14px/1.45 "Arial Narrow",Arial,sans-serif;word-wrap:break-word;overflow-wrap:anywhere}
img{max-width:100%;height:auto}table{max-width:100%}a{color:#0b57d0}
blockquote{margin:4px 0;padding:4px 8px;background:#f2f2f2;border-radius:4px;color:#333}
pre{white-space:pre-wrap}
</style></head><body>${bodyHtml}</body></html>`
}

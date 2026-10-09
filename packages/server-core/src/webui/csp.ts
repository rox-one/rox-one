/**
 * Content-Security-Policy + baseline security headers for the browser WebUI.
 *
 * The WebUI serves a small HTML shell (login page, SPA fallback) with an inline
 * `<script>` / `<style>` block, so the policy is built per response from the
 * exact bytes being served:
 *
 * - Inline scripts are allowed by their SHA-256 hash (`'sha256-…'`), computed
 *   from the served document — never with `'unsafe-inline'`.
 * - Inline styles stay allowed because the shell ships its critical loader /
 *   login styles inline; this is deliberate and documented here.
 * - Google Fonts hosts are allowed because the SPA shell links the JetBrains
 *   Mono stylesheet from `fonts.googleapis.com` (`apps/webui/src/index.html`);
 *   self-hosting that font would let us drop the allowance.
 *
 * Modelled on OpenClaw `src/gateway/control-ui-csp.ts`.
 */

import { createHash } from 'node:crypto'

/** Matches attribute names inside a `<script …>` open tag (name + optional value). */
const SCRIPT_ATTRIBUTE_NAME_RE = /\s([^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g

/**
 * Compute SHA-256 CSP hashes for inline `<script>` blocks in an HTML string.
 * Scripts with a `src` attribute are external and are skipped.
 */
export function computeInlineScriptHashes(html: string): string[] {
  const hashes: string[] = []
  const re = /<script(?:\s[^>]*)?>([^]*?)<\/script>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    const openTag = match[0].slice(0, match[0].indexOf('>') + 1)
    if (
      Array.from(openTag.matchAll(SCRIPT_ATTRIBUTE_NAME_RE)).some(
        attribute => attribute[1]?.toLowerCase() === 'src',
      )
    ) {
      continue
    }
    const content = match[1]
    if (!content) continue
    const hash = createHash('sha256').update(content, 'utf8').digest('base64')
    hashes.push(`sha256-${hash}`)
  }
  return hashes
}

/** Baseline response headers applied to every WebUI response. */
export const WEBUI_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

/**
 * Build the CSP header value for a WebUI document.
 *
 * `html` should be the exact document body the browser will receive; its inline
 * scripts are hashed so the strict `script-src` admits them without
 * `'unsafe-inline'`.
 */
export function buildWebuiCspHeader(html: string): string {
  const scriptTokens = ["'self'", ...computeInlineScriptHashes(html).map(hash => `'${hash}'`)]
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src 'self'",
    "form-action 'self'",
    `script-src ${scriptTokens.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob:",
    "font-src 'self' https://fonts.gstatic.com",
    "media-src 'self' data: blob:",
    "connect-src 'self' ws: wss:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; ')
}

/**
 * Apply security headers in place to a mutable header bag. `html` is the served
 * document body when the response is HTML; omit it for non-document responses.
 */
export function applyWebuiSecurityHeaders(headers: Headers, html?: string): void {
  for (const [name, value] of Object.entries(WEBUI_SECURITY_HEADERS)) {
    headers.set(name, value)
  }
  headers.set('Content-Security-Policy', buildWebuiCspHeader(html ?? ''))
}

/**
 * Return a copy of `res` carrying the security headers. HTML responses are read
 * (via clone) so their inline-script hashes can be computed; other responses get
 * the hash-free baseline policy.
 */
export async function withWebuiSecurityHeaders(res: Response): Promise<Response> {
  const headers = new Headers(res.headers)
  const contentType = (headers.get('content-type') ?? '').toLowerCase()
  const html = contentType.includes('text/html') ? await res.clone().text() : undefined
  applyWebuiSecurityHeaders(headers, html)
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}
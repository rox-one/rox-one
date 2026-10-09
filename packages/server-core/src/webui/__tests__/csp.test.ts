import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import {
  applyWebuiSecurityHeaders,
  buildWebuiCspHeader,
  computeInlineScriptHashes,
  withWebuiSecurityHeaders,
  WEBUI_SECURITY_HEADERS,
} from '../csp'

function sha256Base64(content: string): string {
  return `sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}`
}

const INLINE_SCRIPT = "const greeting = 'hello';\nconsole.log(greeting);\n"

const SAMPLE_HTML = [
  '<!doctype html><html><head>',
  '<style>body { color: red }</style>',
  '<script src="/assets/main.js"></script>',
  '</head><body>',
  `<script>${INLINE_SCRIPT}</script>`,
  '</body></html>',
].join('')

describe('computeInlineScriptHashes', () => {
  it('hashes inline scripts and skips external (src) scripts', () => {
    expect(computeInlineScriptHashes(SAMPLE_HTML)).toEqual([sha256Base64(INLINE_SCRIPT)])
  })

  it('returns no hashes for a document without inline scripts', () => {
    expect(computeInlineScriptHashes('<script src="/x.js"></script>')).toEqual([])
    expect(computeInlineScriptHashes('<p>plain</p>')).toEqual([])
  })
})

describe('buildWebuiCspHeader', () => {
  it('emits the required directives', () => {
    const csp = buildWebuiCspHeader(SAMPLE_HTML)
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("connect-src 'self' ws: wss:")
    expect(csp).toContain("img-src 'self' data: blob:")
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    expect(csp).toContain("script-src 'self'")
  })

  it('admits inline scripts by their exact sha256 hash, never unsafe-inline', () => {
    const csp = buildWebuiCspHeader(SAMPLE_HTML)
    const expected = sha256Base64(INLINE_SCRIPT)
    expect(csp).toContain(`'${expected}'`)
    const scriptDirective = csp.split('; ').find(part => part.startsWith('script-src'))!
    expect(scriptDirective).not.toContain('unsafe-inline')
    expect(scriptDirective).not.toContain('unsafe-eval')
  })

  it('changes the admitted hash when the inline script is tampered with', () => {
    const original = buildWebuiCspHeader(SAMPLE_HTML)
    const tampered = buildWebuiCspHeader(SAMPLE_HTML.replace('hello', 'pwned'))
    const originalHash = sha256Base64(INLINE_SCRIPT)
    const tamperedHash = sha256Base64(INLINE_SCRIPT.replace('hello', 'pwned'))
    expect(original).toContain(`'${originalHash}'`)
    expect(tampered).toContain(`'${tamperedHash}'`)
    expect(tampered).not.toContain(`'${originalHash}'`)
    expect(tampered).not.toEqual(original)
  })

  it('allows only the baseline script-src when there are no inline scripts', () => {
    const scriptDirective = buildWebuiCspHeader('<p>no scripts</p>')
      .split('; ').find(part => part.startsWith('script-src'))!
    expect(scriptDirective).toBe("script-src 'self'")
  })
})

describe('shipped login page hash', () => {
  const loginHtml = readFileSync(
    join(import.meta.dir, '../../../../../apps/webui/src/login.html'),
    'utf8',
  )

  it('is admitted by the policy built from the real served document', () => {
    const hashes = computeInlineScriptHashes(loginHtml)
    expect(hashes.length).toBe(1)
    expect(buildWebuiCspHeader(loginHtml)).toContain(`'${hashes[0]}'`)
  })

  it('would be rejected by a policy built from a tampered copy', () => {
    const real = computeInlineScriptHashes(loginHtml)[0]!
    const tamperedHtml = loginHtml.replace("let lang = 'ru';", "let lang = 'xx';")
    expect(tamperedHtml).not.toBe(loginHtml)
    expect(buildWebuiCspHeader(tamperedHtml)).not.toContain(`'${real}'`)
  })
})

describe('applyWebuiSecurityHeaders', () => {
  it('sets the static headers plus the CSP', () => {
    const headers = new Headers()
    applyWebuiSecurityHeaders(headers, SAMPLE_HTML)
    for (const [name, value] of Object.entries(WEBUI_SECURITY_HEADERS)) {
      expect(headers.get(name)).toBe(value)
    }
    expect(headers.get('content-security-policy')).toContain(sha256Base64(INLINE_SCRIPT))
  })
})

describe('withWebuiSecurityHeaders', () => {
  it('returns a new response carrying the headers for HTML documents', async () => {
    const res = await withWebuiSecurityHeaders(new Response(SAMPLE_HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }))
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('content-security-policy')).toContain(sha256Base64(INLINE_SCRIPT))
    expect(await res.text()).toBe(SAMPLE_HTML)
  })

  it('applies the hash-free baseline to non-HTML responses', async () => {
    const res = await withWebuiSecurityHeaders(Response.json({ ok: true }))
    expect(res.headers.get('content-security-policy')).toBe(buildWebuiCspHeader(''))
    expect(await res.json()).toEqual({ ok: true })
  })

  it('preserves status and secures error/redirect responses', async () => {
    const notFound = await withWebuiSecurityHeaders(new Response('nope', { status: 404 }))
    expect(notFound.status).toBe(404)
    expect(notFound.headers.get('x-frame-options')).toBe('DENY')
    const redirect = await withWebuiSecurityHeaders(Response.redirect('/login', 302))
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('location')).toBe('/login')
    expect(redirect.headers.get('x-content-type-options')).toBe('nosniff')
  })
})
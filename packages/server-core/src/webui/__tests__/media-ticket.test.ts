import { afterEach, describe, expect, it, vi } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MEDIA_TICKET_DEFAULT_TTL_MS,
  MEDIA_TICKET_MAX_TTL_MS,
  createMediaTicket,
  mediaSessionFingerprint,
  resolveMediaFile,
  verifyMediaTicket,
} from '../media-ticket'
import { buildWebuiCspHeader } from '../csp'
import { createWebuiHandler, type WebuiHandler } from '../http-server'
import type { Logger } from '../../runtime/platform'

const SECRET = 'media-ticket-test-secret'
const PASSWORD = 'media-ticket-test-password'
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

const TEMP_DIRS: string[] = []
const HANDLERS: WebuiHandler[] = []

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP_DIRS.push(dir)
  return dir
}

function createMediaHandler(overrides?: { logger?: Logger; secret?: string }): WebuiHandler {
  const webuiDir = makeTempDir('craft-webui-media-')
  writeFileSync(join(webuiDir, 'login.html'), '<!doctype html><html><body>login</body></html>')
  writeFileSync(join(webuiDir, 'index.html'), '<!doctype html><html><body>app shell</body></html>')

  const mediaDir = join(webuiDir, 'media')
  mkdirSync(mediaDir)
  writeFileSync(join(mediaDir, 'pic.png'), PNG_BYTES)
  writeFileSync(join(mediaDir, 'note.txt'), 'hello media')

  const handler = createWebuiHandler({
    webuiDir,
    secret: overrides?.secret ?? SECRET,
    password: PASSWORD,
    wsProtocol: 'ws',
    wsPort: 9100,
    getHealthCheck: () => ({ status: 'ok' }),
    logger: overrides?.logger ?? silentLogger,
  })
  HANDLERS.push(handler)
  return handler
}

async function login(handler: WebuiHandler): Promise<string> {
  const res = await handler.fetch(new Request('http://127.0.0.1/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  }))
  expect(res.status).toBe(200)
  return res.headers.get('set-cookie')!.split(';')[0]!
}

async function mintTicket(
  handler: WebuiHandler,
  cookie: string,
  path: string,
): Promise<{ url: string; expiresAt: number }> {
  const res = await handler.fetch(new Request('http://127.0.0.1/media/ticket', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }))
  expect(res.status).toBe(200)
  return await res.json() as { url: string; expiresAt: number }
}

afterEach(() => {
  while (HANDLERS.length > 0) HANDLERS.pop()?.dispose()
  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('media-ticket module', () => {
  const fp = 'session-fingerprint-a'

  it('round-trips a ticket minted for a path and session', () => {
    const { ticket, expiresAt } = createMediaTicket({
      secret: SECRET,
      path: '/media/pic.png',
      sessionFingerprint: fp,
      now: 1_000,
      ttlMs: 2_000,
    })
    expect(ticket).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(expiresAt).toBe(3_000)

    const verified = verifyMediaTicket(ticket, {
      secret: SECRET,
      path: '/media/pic.png',
      sessionFingerprint: fp,
      now: 1_500,
    })
    expect(verified).toEqual({ path: '/media/pic.png', exp: 3_000, sid: fp })
  })

  it('rejects an expired ticket', () => {
    const { ticket } = createMediaTicket({
      secret: SECRET,
      path: '/media/pic.png',
      sessionFingerprint: fp,
      now: 0,
      ttlMs: 1_000,
    })
    expect(verifyMediaTicket(ticket, {
      secret: SECRET,
      path: '/media/pic.png',
      sessionFingerprint: fp,
      now: 1_001,
    })).toBeNull()
  })

  it('rejects a ticket signed by a different secret', () => {
    const { ticket } = createMediaTicket({
      secret: 'other-server-secret',
      path: '/media/pic.png',
      sessionFingerprint: fp,
      now: 0,
    })
    expect(verifyMediaTicket(ticket, {
      secret: SECRET,
      path: '/media/pic.png',
      sessionFingerprint: fp,
      now: 0,
    })).toBeNull()
  })

  it('rejects a payload that was tampered with while keeping the old signature', () => {
    const { ticket } = createMediaTicket({
      secret: SECRET,
      path: '/media/pic.png',
      sessionFingerprint: fp,
      now: 0,
    })
    const [, encodedPayload, signature] = ticket.split('.')
    const payload = JSON.parse(Buffer.from(encodedPayload!, 'base64url').toString('utf8'))
    payload.path = '/media/secret.txt'
    const forged = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    expect(verifyMediaTicket(`v1.${forged}.${signature}`, {
      secret: SECRET,
      path: '/media/secret.txt',
      sessionFingerprint: fp,
      now: 0,
    })).toBeNull()
  })

  it('rejects a ticket whose signature bytes were flipped', () => {
    const { ticket } = createMediaTicket({
      secret: SECRET,
      path: '/media/pic.png',
      sessionFingerprint: fp,
      now: 0,
    })
    const tampered = `${ticket.slice(0, -1)}${ticket.endsWith('A') ? 'B' : 'A'}`
    expect(verifyMediaTicket(tampered, {
      secret: SECRET,
      path: '/media/pic.png',
      sessionFingerprint: fp,
      now: 0,
    })).toBeNull()
  })

  it('rejects a ticket issued for another session', () => {
    const { ticket } = createMediaTicket({
      secret: SECRET,
      path: '/media/pic.png',
      sessionFingerprint: 'session-a',
      now: 0,
    })
    expect(verifyMediaTicket(ticket, {
      secret: SECRET,
      path: '/media/pic.png',
      sessionFingerprint: 'session-b',
      now: 0,
    })).toBeNull()
    expect(verifyMediaTicket(ticket, {
      secret: SECRET,
      path: '/media/pic.png',
      sessionFingerprint: null,
      now: 0,
    })).toBeNull()
  })

  it('rejects a ticket issued for another path', () => {
    const { ticket } = createMediaTicket({
      secret: SECRET,
      path: '/media/pic.png',
      sessionFingerprint: fp,
      now: 0,
    })
    expect(verifyMediaTicket(ticket, {
      secret: SECRET,
      path: '/media/other.png',
      sessionFingerprint: fp,
      now: 0,
    })).toBeNull()
  })

  it('rejects malformed tickets without throwing', () => {
    for (const malformed of ['', 'v1', 'v1.only-two', 'v2.a.b', 'v1..sig', 'v1.payload.', 'not-a-ticket', 'v1.a.b.c']) {
      expect(verifyMediaTicket(malformed, {
        secret: SECRET,
        path: '/media/pic.png',
        sessionFingerprint: fp,
        now: 0,
      })).toBeNull()
    }
    expect(verifyMediaTicket(null, {
      secret: SECRET,
      path: '/media/pic.png',
      sessionFingerprint: fp,
      now: 0,
    })).toBeNull()
  })

  it('clamps the requested TTL to the bounded maximum', () => {
    const { expiresAt } = createMediaTicket({
      secret: SECRET,
      path: '/media/pic.png',
      sessionFingerprint: fp,
      now: 0,
      ttlMs: MEDIA_TICKET_MAX_TTL_MS * 10,
    })
    expect(expiresAt).toBe(MEDIA_TICKET_MAX_TTL_MS)

    const dflt = createMediaTicket({ secret: SECRET, path: '/media/pic.png', sessionFingerprint: fp, now: 0 })
    expect(dflt.expiresAt).toBe(MEDIA_TICKET_DEFAULT_TTL_MS)
  })

  it('derives the signing key from the secret (domain separation, no hard-coded key)', () => {
    const a = createMediaTicket({ secret: 'secret-one', path: '/media/pic.png', sessionFingerprint: fp, now: 0 })
    expect(verifyMediaTicket(a.ticket, { secret: 'secret-two', path: '/media/pic.png', sessionFingerprint: fp, now: 0 })).toBeNull()
    expect(verifyMediaTicket(a.ticket, { secret: 'secret-one', path: '/media/pic.png', sessionFingerprint: fp, now: 0 })).not.toBeNull()
  })

  it('fingerprints only a real session cookie', () => {
    expect(mediaSessionFingerprint(null)).toBeNull()
    expect(mediaSessionFingerprint('other=1')).toBeNull()
    const a = mediaSessionFingerprint('craft_session=token-a')
    const b = mediaSessionFingerprint('craft_session=token-b')
    expect(a).not.toBeNull()
    expect(a).not.toBe(b)
    expect(mediaSessionFingerprint('craft_session=token-a')).toBe(a)
    // The fingerprint never reveals the credential itself.
    expect(a).not.toContain('token-a')
  })

  it('confines media resolution to the media directory', () => {
    const mediaDir = makeTempDir('craft-webui-media-resolve-')
    expect(resolveMediaFile(mediaDir, '/media/pic.png')).toBe(join(mediaDir, 'pic.png'))
    expect(resolveMediaFile(mediaDir, '/other/pic.png')).toBeNull()
    expect(resolveMediaFile(mediaDir, '/media/')).toBeNull()
    expect(resolveMediaFile(mediaDir, '/media/../../etc/passwd')).toBeNull()
    expect(resolveMediaFile(mediaDir, '/media/..%2f..%2fetc/passwd')).toBeNull()
  })
})

describe('media ticket HTTP flow', () => {
  it('requires authentication to mint', async () => {
    const handler = createMediaHandler()
    const res = await handler.fetch(new Request('http://127.0.0.1/media/ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/media/pic.png' }),
    }))
    expect(res.status).toBe(401)
  })

  it('rejects a cross-origin mint even with a valid session cookie', async () => {
    const handler = createMediaHandler()
    const cookie = await login(handler)
    const res = await handler.fetch(new Request('http://127.0.0.1/media/ticket', {
      method: 'POST',
      headers: { cookie, Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/media/pic.png' }),
    }))
    expect(res.status).toBe(403)
  })

  it('rejects a mint for a path outside the media prefix', async () => {
    const handler = createMediaHandler()
    const cookie = await login(handler)
    const res = await handler.fetch(new Request('http://127.0.0.1/media/ticket', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/api/config' }),
    }))
    expect(res.status).toBe(400)
  })

  it('serves the media through a valid ticket URL', async () => {
    const handler = createMediaHandler()
    const cookie = await login(handler)
    const { url, expiresAt } = await mintTicket(handler, cookie, '/media/pic.png')
    expect(url.startsWith('/media/pic.png?ticket=v1.')).toBe(true)
    expect(expiresAt).toBeGreaterThan(Date.now())

    const res = await handler.fetch(new Request(`http://127.0.0.1${url}`, { headers: { cookie } }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES)
  })

  it('serves a non-image media file with its own content type', async () => {
    const handler = createMediaHandler()
    const cookie = await login(handler)
    const { url } = await mintTicket(handler, cookie, '/media/note.txt')
    const res = await handler.fetch(new Request(`http://127.0.0.1${url}`, { headers: { cookie } }))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello media')
  })

  it('refuses expired, tampered, other-session and malformed tickets identically', async () => {
    const handler = createMediaHandler()
    const cookie = await login(handler)
    const fingerprint = mediaSessionFingerprint(cookie)!

    const expired = createMediaTicket({
      secret: SECRET,
      path: '/media/pic.png',
      sessionFingerprint: fingerprint,
      now: Date.now() - 600_000,
      ttlMs: 1_000,
    })
    const valid = await mintTicket(handler, cookie, '/media/pic.png')
    const validTicket = new URL(`http://127.0.0.1${valid.url}`).searchParams.get('ticket')!
    const tampered = `${validTicket.slice(0, -1)}${validTicket.endsWith('A') ? 'B' : 'A'}`
    const otherSession = createMediaTicket({
      secret: SECRET,
      path: '/media/pic.png',
      sessionFingerprint: 'some-other-session',
    })

    // No session cookie at all — the ticket cannot be bound.
    const noSession = await handler.fetch(new Request(`http://127.0.0.1/media/pic.png?ticket=${validTicket}`))

    const cases: Array<[string, Response]> = [
      ['expired', await handler.fetch(new Request(`http://127.0.0.1/media/pic.png?ticket=${encodeURIComponent(expired.ticket)}`, { headers: { cookie } }))],
      ['tampered', await handler.fetch(new Request(`http://127.0.0.1/media/pic.png?ticket=${encodeURIComponent(tampered)}`, { headers: { cookie } }))],
      ['other-session', await handler.fetch(new Request(`http://127.0.0.1/media/pic.png?ticket=${encodeURIComponent(otherSession.ticket)}`, { headers: { cookie } }))],
      ['malformed', await handler.fetch(new Request('http://127.0.0.1/media/pic.png?ticket=garbage', { headers: { cookie } }))],
      ['no-ticket', await handler.fetch(new Request('http://127.0.0.1/media/pic.png', { headers: { cookie } }))],
    ]

    expect(noSession.status).toBe(403)
    for (const [label, res] of cases) {
      expect(res.status).toBe(403)
      expect(res.headers.get('cache-control')).toBe('no-store')
      const body = await res.text()
      // Uniform body: no failure mode leaks which check failed, and the ticket
      // is never echoed back.
      expect(JSON.parse(body)).toEqual({ error: 'Media ticket rejected' })
      expect(body).not.toContain(validTicket)
      expect(body).not.toContain(label)
    }
    // A valid ticket still serves — the refusals were not a blanket denial.
    const ok = await handler.fetch(new Request(`http://127.0.0.1${valid.url}`, { headers: { cookie } }))
    expect(ok.status).toBe(200)
  })

  it('refuses a ticket minted for a different real session', async () => {
    const handler = createMediaHandler()
    vi.useFakeTimers()
    try {
      const cookieA = await login(handler)
      vi.advanceTimersByTime(2_000)
      const cookieB = await login(handler)
      expect(cookieB).not.toBe(cookieA)

      const { url } = await mintTicket(handler, cookieA, '/media/pic.png')
      expect((await handler.fetch(new Request(`http://127.0.0.1${url}`, { headers: { cookie: cookieB } }))).status).toBe(403)
      expect((await handler.fetch(new Request(`http://127.0.0.1${url}`, { headers: { cookie: cookieA } }))).status).toBe(200)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not change the CSP response headers on media or refusals', async () => {
    const handler = createMediaHandler()
    const cookie = await login(handler)
    const { url } = await mintTicket(handler, cookie, '/media/pic.png')

    const media = await handler.fetch(new Request(`http://127.0.0.1${url}`, { headers: { cookie } }))
    const refused = await handler.fetch(new Request('http://127.0.0.1/media/pic.png?ticket=garbage', { headers: { cookie } }))
    const control = await handler.fetch(new Request('http://127.0.0.1/health'))

    const baseline = buildWebuiCspHeader('')
    expect(media.headers.get('content-security-policy')).toBe(baseline)
    expect(refused.headers.get('content-security-policy')).toBe(baseline)
    expect(media.headers.get('content-security-policy')).toBe(control.headers.get('content-security-policy'))
    // The feature adds no wildcard and no extra data:/blob: allowance.
    expect(media.headers.get('content-security-policy')).not.toContain('*')
  })

  it('never logs the ticket value', async () => {
    const calls: string[] = []
    const logger: Logger = {
      info: (...args: unknown[]) => calls.push(JSON.stringify(args)),
      warn: (...args: unknown[]) => calls.push(JSON.stringify(args)),
      error: (...args: unknown[]) => calls.push(JSON.stringify(args)),
      debug: (...args: unknown[]) => calls.push(JSON.stringify(args)),
    }
    const handler = createMediaHandler({ logger })
    const cookie = await login(handler)
    const { url } = await mintTicket(handler, cookie, '/media/pic.png')
    const ticket = new URL(`http://127.0.0.1${url}`).searchParams.get('ticket')!

    await handler.fetch(new Request(`http://127.0.0.1${url}`, { headers: { cookie } }))
    await handler.fetch(new Request('http://127.0.0.1/media/pic.png?ticket=garbage', { headers: { cookie } }))

    expect(calls.length).toBeGreaterThan(0)
    for (const entry of calls) {
      expect(entry).not.toContain(ticket)
      expect(entry).not.toContain('ticket=')
    }
  })
})
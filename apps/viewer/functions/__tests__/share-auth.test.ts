/**
 * Share API security suite (P0): owner-capability auth for share mutations.
 *
 * Model under test (see apps/viewer/SECURITY.md):
 *   - share id  = public read capability   (GET stays unauthenticated)
 *   - ownerKey  = owner mutation capability (PUT/DELETE require it)
 *   - server stores only SHA-256(ownerKey) in R2 custom metadata
 *   - legacy shares (no hash) stay readable but are immutable: LEGACY_SHARE_IMMUTABLE
 */
import { describe, expect, it } from 'bun:test'
import { FakeR2Bucket, jsonRequest, mutateRequest, uniqueIp } from './fake-r2'
import { onRequestOptions, onRequestPost } from '../s/api'
import {
  onRequestDelete,
  onRequestGet,
  onRequestOptions as onRequestOptionsById,
  onRequestPut,
} from '../s/api/[id]'

const MAX_SHARE_BYTES = 25 * 1024 * 1024

function makeEnv() {
  return { SHARES: new FakeR2Bucket() }
}

async function createShare(env: ReturnType<typeof makeEnv>, body?: unknown) {
  const request = jsonRequest('https://viewer.test/s/api', 'POST', body ?? {
    id: 'session-1',
    messages: [{ type: 'user', content: 'hello' }],
  })
  const res = await onRequestPost({ request, env } as never)
  return { res, data: (await res.json()) as Record<string, unknown> }
}

describe('POST /s/api (create)', () => {
  it('returns share id AND a high-entropy ownerKey', async () => {
    const env = makeEnv()
    const { res, data } = await createShare(env)

    expect(res.status).toBe(201)
    expect(typeof data.id).toBe('string')
    expect(data.id).toMatch(/^[A-Za-z0-9_-]{21}$/)
    expect(typeof data.ownerKey).toBe('string')
    // 32 random bytes, base64url => 43 chars (>= 256 bits of entropy)
    expect((data.ownerKey as string).length).toBeGreaterThanOrEqual(43)
    expect(data.ownerKey).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(data.url).toContain(`/s/${data.id}`)
  })

  it('stores only a SHA-256 hash of the ownerKey, never the raw key', async () => {
    const env = makeEnv()
    const { data } = await createShare(env)

    const stored = env.SHARES.inspect(data.id as string)
    expect(stored).toBeDefined()
    const hash = stored!.customMetadata?.ownerkeyhash
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toBe(data.ownerKey)
    // Raw key must not appear anywhere in the stored body or the create response
    expect(stored!.body).not.toContain(data.ownerKey as string)
    expect(data.ownerKeyHash).toBeUndefined()
    expect(data.ownerKeyHashHex).toBeUndefined()
  })

  it('issues distinct ownerKeys per share', async () => {
    const env = makeEnv()
    const a = await createShare(env)
    const b = await createShare(env)
    expect(a.data.ownerKey).not.toBe(b.data.ownerKey)
    expect(a.data.id).not.toBe(b.data.id)
  })

  it('rejects payloads over 25MB declared via Content-Length before reading the body', async () => {
    const env = makeEnv()
    const request = new Request('https://viewer.test/s/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(MAX_SHARE_BYTES + 1),
      },
      body: JSON.stringify({ id: 'x', messages: [] }),
    })
    const res = await onRequestPost({ request, env } as never)
    expect(res.status).toBe(413)
    const data = (await res.json()) as Record<string, unknown>
    expect(data.code).toBe('SHARE_TOO_LARGE')
  })

  it('rejects oversized real bodies with 413 even without Content-Length games', async () => {
    const env = makeEnv()
    const big = { id: 'x', messages: [{ type: 'user', content: 'a'.repeat(MAX_SHARE_BYTES) }] }
    const res = await onRequestPost({ request: jsonRequest('https://viewer.test/s/api', 'POST', big), env } as never)
    expect(res.status).toBe(413)
    const data = (await res.json()) as Record<string, unknown>
    expect(data.code).toBe('SHARE_TOO_LARGE')
  })
})

describe('GET /s/api/:id (public read capability)', () => {
  it('reads a share without any auth header', async () => {
    const env = makeEnv()
    const { data } = await createShare(env)
    const res = await onRequestGet({
      request: new Request(`https://viewer.test/s/api/${data.id}`),
      env,
      params: { id: data.id },
    } as never)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; messages: unknown[] }
    expect(body.id).toBe('session-1')
    expect(Array.isArray(body.messages)).toBe(true)
  })

  it('never leaks the ownerKey or its hash through the public read', async () => {
    const env = makeEnv()
    const { data } = await createShare(env)
    const res = await onRequestGet({
      request: new Request(`https://viewer.test/s/api/${data.id}`),
      env,
      params: { id: data.id },
    } as never)
    const raw = await res.text()
    expect(raw).not.toContain(data.ownerKey as string)
    expect(raw).not.toContain('ownerkeyhash')
  })
})

describe('PUT /s/api/:id (owner mutation capability)', () => {
  it('rejects unauthenticated PUT with 401 SHARE_OWNER_KEY_REQUIRED', async () => {
    const env = makeEnv()
    const { data } = await createShare(env)
    const res = await onRequestPut({
      request: jsonRequest(`https://viewer.test/s/api/${data.id}`, 'PUT', { id: 'session-1', messages: [] }),
      env,
      params: { id: data.id },
    } as never)
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('SHARE_OWNER_KEY_REQUIRED')
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer')
  })

  it('rejects PUT with a wrong ownerKey using 403 SHARE_OWNER_KEY_INVALID', async () => {
    const env = makeEnv()
    const { data } = await createShare(env)
    const res = await onRequestPut({
      request: jsonRequest(`https://viewer.test/s/api/${data.id}`, 'PUT', { id: 'session-1', messages: [] }, {
        Authorization: 'Bearer ' + 'A'.repeat(43),
      }),
      env,
      params: { id: data.id },
    } as never)
    expect(res.status).toBe(403)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('SHARE_OWNER_KEY_INVALID')
  })

  it('rejects PUT with a malformed Authorization scheme', async () => {
    const env = makeEnv()
    const { data } = await createShare(env)
    const res = await onRequestPut({
      request: jsonRequest(`https://viewer.test/s/api/${data.id}`, 'PUT', { id: 'session-1', messages: [] }, {
        Authorization: 'Basic dXNlcjpwYXNz',
      }),
      env,
      params: { id: data.id },
    } as never)
    expect(res.status).toBe(401)
  })

  it('accepts PUT with the correct ownerKey and persists the new content', async () => {
    const env = makeEnv()
    const { data } = await createShare(env)
    const updated = { id: 'session-1', messages: [{ type: 'assistant', content: 'v2' }] }
    const res = await onRequestPut({
      request: jsonRequest(`https://viewer.test/s/api/${data.id}`, 'PUT', updated, {
        Authorization: `Bearer ${data.ownerKey}`,
      }),
      env,
      params: { id: data.id },
    } as never)
    expect(res.status).toBe(200)

    const got = await onRequestGet({
      request: new Request(`https://viewer.test/s/api/${data.id}`),
      env,
      params: { id: data.id },
    } as never)
    const body = (await got.json()) as { messages: { content: string }[] }
    expect(body.messages[0]!.content).toBe('v2')
  })

  it('keeps the owner capability valid across updates (hash survives PUT)', async () => {
    const env = makeEnv()
    const { data } = await createShare(env)
    const auth = { Authorization: `Bearer ${data.ownerKey}` }
    const first = await onRequestPut({
      request: jsonRequest(`https://viewer.test/s/api/${data.id}`, 'PUT', { id: 'session-1', messages: [] }, auth),
      env,
      params: { id: data.id },
    } as never)
    expect(first.status).toBe(200)
    const second = await onRequestPut({
      request: jsonRequest(`https://viewer.test/s/api/${data.id}`, 'PUT', { id: 'session-1', messages: [] }, auth),
      env,
      params: { id: data.id },
    } as never)
    expect(second.status).toBe(200)
  })

  it('also accepts the X-Share-Owner-Key header', async () => {
    const env = makeEnv()
    const { data } = await createShare(env)
    const res = await onRequestPut({
      request: jsonRequest(`https://viewer.test/s/api/${data.id}`, 'PUT', { id: 'session-1', messages: [] }, {
        'X-Share-Owner-Key': data.ownerKey as string,
      }),
      env,
      params: { id: data.id },
    } as never)
    expect(res.status).toBe(200)
  })

  it('rejects oversized PUT bodies with 413 SHARE_TOO_LARGE', async () => {
    const env = makeEnv()
    const { data } = await createShare(env)
    const big = { id: 'session-1', messages: [{ type: 'user', content: 'a'.repeat(MAX_SHARE_BYTES) }] }
    const res = await onRequestPut({
      request: jsonRequest(`https://viewer.test/s/api/${data.id}`, 'PUT', big, {
        Authorization: `Bearer ${data.ownerKey}`,
      }),
      env,
      params: { id: data.id },
    } as never)
    expect(res.status).toBe(413)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('SHARE_TOO_LARGE')
  })
})

describe('DELETE /s/api/:id (owner mutation capability)', () => {
  it('rejects unauthenticated DELETE with 401', async () => {
    const env = makeEnv()
    const { data } = await createShare(env)
    const res = await onRequestDelete({
      request: mutateRequest(`https://viewer.test/s/api/${data.id}`, 'DELETE'),
      env,
      params: { id: data.id },
    } as never)
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('SHARE_OWNER_KEY_REQUIRED')
    // Object must still exist
    expect(env.SHARES.inspect(data.id as string)).toBeDefined()
  })

  it('rejects DELETE with a wrong ownerKey using 403', async () => {
    const env = makeEnv()
    const { data } = await createShare(env)
    const res = await onRequestDelete({
      request: mutateRequest(`https://viewer.test/s/api/${data.id}`, 'DELETE', {
        Authorization: 'Bearer ' + 'B'.repeat(43),
      }),
      env,
      params: { id: data.id },
    } as never)
    expect(res.status).toBe(403)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('SHARE_OWNER_KEY_INVALID')
    expect(env.SHARES.inspect(data.id as string)).toBeDefined()
  })

  it('deletes with the correct ownerKey; afterwards all access is 404 SHARE_NOT_FOUND', async () => {
    const env = makeEnv()
    const { data } = await createShare(env)
    const del = await onRequestDelete({
      request: mutateRequest(`https://viewer.test/s/api/${data.id}`, 'DELETE', {
        Authorization: `Bearer ${data.ownerKey}`,
      }),
      env,
      params: { id: data.id },
    } as never)
    expect(del.status).toBe(204)

    const get = await onRequestGet({
      request: new Request(`https://viewer.test/s/api/${data.id}`),
      env,
      params: { id: data.id },
    } as never)
    expect(get.status).toBe(404)
    expect(((await get.json()) as Record<string, unknown>).code).toBe('SHARE_NOT_FOUND')

    // Mutation of a revoked share is rejected even with the once-valid key
    const put = await onRequestPut({
      request: jsonRequest(`https://viewer.test/s/api/${data.id}`, 'PUT', { id: 'session-1', messages: [] }, {
        Authorization: `Bearer ${data.ownerKey}`,
      }),
      env,
      params: { id: data.id },
    } as never)
    expect(put.status).toBe(404)
    expect(((await put.json()) as Record<string, unknown>).code).toBe('SHARE_NOT_FOUND')
  })
})

describe('legacy shares (created before owner keys existed)', () => {
  function seedLegacy(env: ReturnType<typeof makeEnv>, id = 'legacyshare1234567890') {
    env.SHARES.seedLegacy(id, JSON.stringify({ id: 'legacy-session', messages: [] }))
    return id
  }

  it('legacy shares remain publicly readable', async () => {
    const env = makeEnv()
    const id = seedLegacy(env)
    const res = await onRequestGet({
      request: new Request(`https://viewer.test/s/api/${id}`),
      env,
      params: { id },
    } as never)
    expect(res.status).toBe(200)
  })

  it('rejects legacy PUT with 403 LEGACY_SHARE_IMMUTABLE even when a key is presented', async () => {
    const env = makeEnv()
    const id = seedLegacy(env)
    const res = await onRequestPut({
      request: jsonRequest(`https://viewer.test/s/api/${id}`, 'PUT', { id: 'legacy-session', messages: [] }, {
        Authorization: 'Bearer ' + 'C'.repeat(43),
      }),
      env,
      params: { id },
    } as never)
    expect(res.status).toBe(403)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('LEGACY_SHARE_IMMUTABLE')
  })

  it('rejects legacy DELETE with 403 LEGACY_SHARE_IMMUTABLE', async () => {
    const env = makeEnv()
    const id = seedLegacy(env)
    const res = await onRequestDelete({
      request: mutateRequest(`https://viewer.test/s/api/${id}`, 'DELETE', {
        Authorization: 'Bearer ' + 'C'.repeat(43),
      }),
      env,
      params: { id },
    } as never)
    expect(res.status).toBe(403)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('LEGACY_SHARE_IMMUTABLE')
    expect(env.SHARES.inspect(id)).toBeDefined()
  })
})

describe('CORS', () => {
  it('preflight allows exactly the intended methods and headers', async () => {
    const res = await onRequestOptions({ request: new Request('https://viewer.test/s/api') } as never)
    expect(res.status).toBe(204)
    const methods = res.headers.get('Access-Control-Allow-Methods') ?? ''
    for (const m of ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']) expect(methods).toContain(m)
    expect(methods).not.toContain('PATCH')
    const headers = (res.headers.get('Access-Control-Allow-Headers') ?? '').toLowerCase()
    expect(headers).toContain('content-type')
    expect(headers).toContain('authorization')
    expect(headers).toContain('x-share-owner-key')
  })

  it('preflight on the :id route matches the create route policy', async () => {
    const res = await onRequestOptionsById({ request: new Request('https://viewer.test/s/api/abc') } as never)
    const headers = (res.headers.get('Access-Control-Allow-Headers') ?? '').toLowerCase()
    expect(headers).toContain('authorization')
  })

  it('mutation error responses still carry CORS headers', async () => {
    const env = makeEnv()
    const { data } = await createShare(env)
    const res = await onRequestDelete({
      request: mutateRequest(`https://viewer.test/s/api/${data.id}`, 'DELETE'),
      env,
      params: { id: data.id },
    } as never)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})

/**
 * R2-faithful fake: assigns etags and honors `put(..., { onlyIf: { etagMatches } })`.
 * `FakeR2Bucket` ignores preconditions (the production bug); this double is what
 * makes a lost-update observable in-process.
 */
class EtagR2Bucket extends FakeR2Bucket {
  private etags = new Map<string, string>()
  private seq = 0
  private headBarrier: { needed: number; started: number; wait: Promise<void>; release: () => void } | null = null

  /** Next `n` head() calls wait until all n have started, so they observe the same etag. */
  barrierNextHeads(n: number) {
    let release!: () => void
    const wait = new Promise<void>((resolve) => { release = resolve })
    this.headBarrier = { needed: n, started: 0, wait, release }
  }

  override async put(
    key: string,
    value: string,
    opts?: {
      httpMetadata?: { contentType?: string }
      customMetadata?: Record<string, string>
      onlyIf?: { etagMatches?: string }
    },
  ) {
    const current = this.etags.get(key)
    if (opts?.onlyIf?.etagMatches !== undefined && current !== opts.onlyIf.etagMatches) {
      return null
    }
    await super.put(key, value, opts)
    this.seq += 1
    const etag = String(this.seq)
    this.etags.set(key, etag)
    return { key, etag }
  }

  override async head(key: string) {
    const barrier = this.headBarrier
    if (barrier) {
      barrier.started += 1
      if (barrier.started >= barrier.needed) {
        this.headBarrier = null
        barrier.release()
      }
      await barrier.wait
    }
    const obj = await super.head(key)
    if (!obj) return null
    return { ...obj, etag: this.etags.get(key) }
  }

  override async get(key: string) {
    const obj = await super.get(key)
    if (!obj) return null
    return { ...obj, etag: this.etags.get(key) }
  }

  override async delete(key: string) {
    await super.delete(key)
    this.etags.delete(key)
  }
}

/** 3-byte UTF-8 / 1 UTF-16 code unit. Count chosen so stringify UTF-16 is under 25 MiB and UTF-8 is over. */
function utf16UnderUtf8OverPayload() {
  const content = '€'.repeat(8_800_000)
  const body = { id: 'session-1', messages: [{ type: 'user', content }] }
  const raw = JSON.stringify(body)
  return { body, raw }
}

describe('payload size is UTF-8 bytes, not UTF-16 code units', () => {
  it('rejects POST when UTF-16 length is under 25 MiB but UTF-8 bytes are over', async () => {
    const { body, raw } = utf16UnderUtf8OverPayload()
    expect(raw.length).toBeLessThan(MAX_SHARE_BYTES)
    expect(new TextEncoder().encode(raw).byteLength).toBeGreaterThan(MAX_SHARE_BYTES)

    const env = makeEnv()
    const res = await onRequestPost({
      request: jsonRequest('https://viewer.test/s/api', 'POST', body, {}, uniqueIp()),
      env,
    } as never)
    expect(res.status).toBe(413)
    expect(((await res.json()) as Record<string, unknown>).code).toBe('SHARE_TOO_LARGE')
  })

  it('rejects PUT when UTF-16 length is under 25 MiB but UTF-8 bytes are over', async () => {
    const env = makeEnv()
    const { data } = await createShare(env)
    const { body, raw } = utf16UnderUtf8OverPayload()
    expect(raw.length).toBeLessThan(MAX_SHARE_BYTES)
    expect(new TextEncoder().encode(raw).byteLength).toBeGreaterThan(MAX_SHARE_BYTES)

    const res = await onRequestPut({
      request: jsonRequest(`https://viewer.test/s/api/${data.id}`, 'PUT', body, {
        Authorization: `Bearer ${data.ownerKey}`,
      }, uniqueIp()),
      env,
      params: { id: data.id },
    } as never)
    expect(res.status).toBe(413)
    expect(((await res.json()) as Record<string, unknown>).code).toBe('SHARE_TOO_LARGE')
    const stored = env.SHARES.inspect(data.id as string)
    expect(stored!.body).not.toContain('€')
  })
})

describe('X-Content-Type-Options: nosniff', () => {
  it('is present on public GET of share JSON', async () => {
    const env = makeEnv()
    const { data } = await createShare(env)
    const res = await onRequestGet({
      request: new Request(`https://viewer.test/s/api/${data.id}`),
      env,
      params: { id: data.id },
    } as never)
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('is present on create, update, and mutation-error JSON responses', async () => {
    const env = makeEnv()
    const created = await onRequestPost({
      request: jsonRequest('https://viewer.test/s/api', 'POST', { id: 'n', messages: [] }, {}, uniqueIp()),
      env,
    } as never)
    expect(created.status).toBe(201)
    expect(created.headers.get('X-Content-Type-Options')).toBe('nosniff')
    const { id, ownerKey } = (await created.json()) as { id: string; ownerKey: string }

    const updated = await onRequestPut({
      request: jsonRequest(`https://viewer.test/s/api/${id}`, 'PUT', { id: 'n', messages: [] }, {
        Authorization: `Bearer ${ownerKey}`,
      }, uniqueIp()),
      env,
      params: { id },
    } as never)
    expect(updated.status).toBe(200)
    expect(updated.headers.get('X-Content-Type-Options')).toBe('nosniff')

    const denied = await onRequestPut({
      request: jsonRequest(`https://viewer.test/s/api/${id}`, 'PUT', { id: 'n', messages: [] }, {}, uniqueIp()),
      env,
      params: { id },
    } as never)
    expect(denied.status).toBe(401)
    expect(denied.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })
})

describe('conditional PUT prevents lost update', () => {
  it('rejects the losing concurrent PUT with 409 SHARE_CONFLICT and keeps one complete version', async () => {
    const shares = new EtagR2Bucket()
    const env = { SHARES: shares }
    const created = await onRequestPost({
      request: jsonRequest('https://viewer.test/s/api', 'POST', { id: 'race', messages: [{ v: 1 }] }, {}, uniqueIp()),
      env,
    } as never)
    expect(created.status).toBe(201)
    const { id, ownerKey } = (await created.json()) as { id: string; ownerKey: string }
    const auth = { Authorization: `Bearer ${ownerKey}` }

    shares.barrierNextHeads(2)
    const [a, b] = await Promise.all([
      onRequestPut({
        request: jsonRequest(`https://viewer.test/s/api/${id}`, 'PUT', { id: 'race', messages: [{ v: 2 }] }, auth, uniqueIp()),
        env,
        params: { id },
      } as never),
      onRequestPut({
        request: jsonRequest(`https://viewer.test/s/api/${id}`, 'PUT', { id: 'race', messages: [{ v: 3 }] }, auth, uniqueIp()),
        env,
        params: { id },
      } as never),
    ])

    const statuses = [a.status, b.status].sort((x, y) => x - y)
    expect(statuses).toEqual([200, 409])
    const loser = a.status === 409 ? a : b
    expect(((await loser.json()) as Record<string, unknown>).code).toBe('SHARE_CONFLICT')

    const got = await onRequestGet({
      request: new Request(`https://viewer.test/s/api/${id}`),
      env,
      params: { id },
    } as never)
    const stored = (await got.json()) as { messages: { v: number }[] }
    expect([2, 3]).toContain(stored.messages[0]!.v)
  })

  it('still accepts a later PUT that re-reads the share after the previous write', async () => {
    const env = { SHARES: new EtagR2Bucket() }
    const created = await onRequestPost({
      request: jsonRequest('https://viewer.test/s/api', 'POST', { id: 'seq', messages: [{ v: 1 }] }, {}, uniqueIp()),
      env,
    } as never)
    const { id, ownerKey } = (await created.json()) as { id: string; ownerKey: string }
    const auth = { Authorization: `Bearer ${ownerKey}` }

    const first = await onRequestPut({
      request: jsonRequest(`https://viewer.test/s/api/${id}`, 'PUT', { id: 'seq', messages: [{ v: 2 }] }, auth, uniqueIp()),
      env,
      params: { id },
    } as never)
    expect(first.status).toBe(200)
    const second = await onRequestPut({
      request: jsonRequest(`https://viewer.test/s/api/${id}`, 'PUT', { id: 'seq', messages: [{ v: 3 }] }, auth, uniqueIp()),
      env,
      params: { id },
    } as never)
    expect(second.status).toBe(200)

    const got = await onRequestGet({
      request: new Request(`https://viewer.test/s/api/${id}`),
      env,
      params: { id },
    } as never)
    expect(((await got.json()) as { messages: { v: number }[] }).messages[0]!.v).toBe(3)
  })
})

describe('full lifecycle smoke (create → read → authed update → unauthed rejected → authed delete)', () => {
  it('walks the owner capability lifecycle end to end', async () => {
    const env = makeEnv()
    const ip = uniqueIp()

    // 1. create
    const create = await onRequestPost({
      request: jsonRequest('https://viewer.test/s/api', 'POST', { id: 'lc', messages: [{ v: 1 }] }, {}, ip),
      env,
    } as never)
    expect(create.status).toBe(201)
    const { id, ownerKey } = (await create.json()) as { id: string; ownerKey: string }

    // 2. public read
    const read = await onRequestGet({
      request: new Request(`https://viewer.test/s/api/${id}`),
      env,
      params: { id },
    } as never)
    expect(read.status).toBe(200)

    // 3. authenticated update
    const update = await onRequestPut({
      request: jsonRequest(`https://viewer.test/s/api/${id}`, 'PUT', { id: 'lc', messages: [{ v: 2 }] }, {
        Authorization: `Bearer ${ownerKey}`,
      }, ip),
      env,
      params: { id },
    } as never)
    expect(update.status).toBe(200)

    // 4. unauthenticated update rejected
    const denied = await onRequestPut({
      request: jsonRequest(`https://viewer.test/s/api/${id}`, 'PUT', { id: 'lc', messages: [{ v: 3 }] }, {}, ip),
      env,
      params: { id },
    } as never)
    expect(denied.status).toBe(401)

    // 5. authenticated delete
    const del = await onRequestDelete({
      request: mutateRequest(`https://viewer.test/s/api/${id}`, 'DELETE', {
        Authorization: `Bearer ${ownerKey}`,
      }, ip),
      env,
      params: { id },
    } as never)
    expect(del.status).toBe(204)
    expect(env.SHARES.inspect(id)).toBeUndefined()
  })
})

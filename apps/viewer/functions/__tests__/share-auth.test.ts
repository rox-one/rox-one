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

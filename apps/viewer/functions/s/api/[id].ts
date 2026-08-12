import {
  CORS,
  MAX_SHARE_BYTES,
  checkDeclaredSize,
  checkOwnerCapability,
  isSessionPayload,
  isValidShareId,
  json,
  originOf,
  rateLimitResponse,
  shareError,
  type Env,
} from '../_shared'

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS })

// Public read: the share id itself is the read capability.
export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  if (!env.SHARES) return shareError('SHARE_STORAGE_NOT_CONFIGURED', 'Share storage not configured', 503)
  const id = String(params.id || '')
  if (!isValidShareId(id)) return shareError('SHARE_NOT_FOUND', 'Not found', 404)
  const obj = await env.SHARES.get(id)
  if (!obj) return shareError('SHARE_NOT_FOUND', 'Not found', 404)
  const body = await obj.text()
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', ...CORS },
  })
}

// Owner-gated mutation: requires Authorization: Bearer <ownerKey>.
export const onRequestPut: PagesFunction<Env> = async ({ request, params, env }) => {
  if (!env.SHARES) return shareError('SHARE_STORAGE_NOT_CONFIGURED', 'Share storage not configured', 503)
  const id = String(params.id || '')
  if (!isValidShareId(id)) return shareError('SHARE_NOT_FOUND', 'Not found', 404)

  const limited = rateLimitResponse('mutate', request)
  if (limited) return limited

  const existing = await env.SHARES.head(id)
  if (!existing) return shareError('SHARE_NOT_FOUND', 'Not found', 404)

  const denied = await checkOwnerCapability(request, existing)
  if (denied) return denied

  const tooLarge = checkDeclaredSize(request)
  if (tooLarge) return tooLarge

  let body: unknown
  try { body = await request.json() } catch { return shareError('INVALID_JSON', 'Invalid JSON body', 400) }
  if (!isSessionPayload(body)) {
    return shareError('INVALID_SESSION_PAYLOAD', 'Invalid session: must have id (string) and messages (array)', 400)
  }
  const raw = JSON.stringify(body)
  if (raw.length > MAX_SHARE_BYTES) return shareError('SHARE_TOO_LARGE', 'Session file is too large to share', 413)

  await env.SHARES.put(id, raw, {
    httpMetadata: { contentType: 'application/json' },
    // Preserve ownerkeyhash (and original createdAt) across updates.
    customMetadata: { ...(existing.customMetadata || {}), sessionId: body.id, updatedAt: String(Date.now()) },
  })
  return json({ id, url: `${originOf(request, env)}/s/${id}` })
}

// Owner-gated mutation: requires Authorization: Bearer <ownerKey>.
export const onRequestDelete: PagesFunction<Env> = async ({ request, params, env }) => {
  if (!env.SHARES) return shareError('SHARE_STORAGE_NOT_CONFIGURED', 'Share storage not configured', 503)
  const id = String(params.id || '')
  if (!isValidShareId(id)) return shareError('SHARE_NOT_FOUND', 'Not found', 404)

  const limited = rateLimitResponse('mutate', request)
  if (limited) return limited

  const existing = await env.SHARES.head(id)
  if (!existing) return shareError('SHARE_NOT_FOUND', 'Not found', 404)

  const denied = await checkOwnerCapability(request, existing)
  if (denied) return denied

  await env.SHARES.delete(id)
  return new Response(null, { status: 204, headers: CORS })
}

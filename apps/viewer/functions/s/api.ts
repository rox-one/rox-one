import {
  CORS,
  OWNER_KEY_HASH_META,
  checkDeclaredSize,
  checkSharePayloadSize,
  isSessionPayload,
  json,
  newId,
  newOwnerKey,
  originOf,
  rateLimitResponse,
  sha256Hex,
  shareError,
  type Env,
} from './_shared'

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS })

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.SHARES) return shareError('SHARE_STORAGE_NOT_CONFIGURED', 'Share storage not configured', 503)

  const limited = rateLimitResponse('create', request)
  if (limited) return limited

  const tooLarge = checkDeclaredSize(request)
  if (tooLarge) return tooLarge

  let body: unknown
  try { body = await request.json() } catch { return shareError('INVALID_JSON', 'Invalid JSON body', 400) }
  if (!isSessionPayload(body)) {
    return shareError('INVALID_SESSION_PAYLOAD', 'Invalid session: must have id (string) and messages (array)', 400)
  }
  const raw = JSON.stringify(body)
  const tooBig = checkSharePayloadSize(raw)
  if (tooBig) return tooBig

  const shareId = newId()
  // Owner mutation capability: returned once to the creator; only its SHA-256
  // hash is stored, so the public read path can never expose it.
  const ownerKey = newOwnerKey()
  const ownerKeyHash = await sha256Hex(ownerKey)
  await env.SHARES.put(shareId, raw, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { sessionId: body.id, createdAt: String(Date.now()), [OWNER_KEY_HASH_META]: ownerKeyHash },
  })
  return json({ id: shareId, url: `${originOf(request, env)}/s/${shareId}`, ownerKey }, 201)
}

export const onRequestGet: PagesFunction<Env> = async () => shareError('SHARE_NOT_FOUND', 'Not found', 404)

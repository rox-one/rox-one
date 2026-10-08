/** Shared HTTP helpers: JSON responses and bounded body reads. */

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}

export type BodyRead = { ok: true; buffer: Buffer } | { ok: false; reason: 'too-large' }

/**
 * Read the request body into a Buffer, refusing anything over `limit` bytes.
 * The declared Content-Length is checked first so an oversized upload is
 * rejected before it is buffered.
 */
export async function readRawBody(request: Request, limit: number): Promise<BodyRead> {
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    const size = Number(declared)
    if (Number.isFinite(size) && size > limit) return { ok: false, reason: 'too-large' }
  }
  let buffer: Buffer
  try {
    buffer = Buffer.from(await request.arrayBuffer())
  } catch {
    return { ok: false, reason: 'too-large' }
  }
  if (buffer.byteLength > limit) return { ok: false, reason: 'too-large' }
  return { ok: true, buffer }
}
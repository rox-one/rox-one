/**
 * Compose the external `/hooks` HTTP ingress (a web-standard fetch handler)
 * with the existing Node HTTP handler used by the WebUI, so both share the
 * WsRpcServer's port.
 *
 * Requests that fall inside the ingress' route prefix are converted to a
 * web-standard `Request`, handed to the ingress, and — when the ingress
 * produces a `Response` — written back. Everything else is delegated to the
 * next handler untouched (importantly, its body stream is NOT consumed first,
 * so the WebUI sees the request exactly as it arrived).
 *
 * The body of a request inside the route prefix is read under the ingress'
 * own `bodyLimitBytes` BEFORE it is buffered: the declared `Content-Length` is
 * checked first, then a running total while streaming. This keeps the same
 * "bodies are bounded BEFORE they are buffered" promise `hooks-http.ts`
 * documents for the fetch path; an oversized body is answered with 413 and
 * never reaches the ingress.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { HooksHttpIngress } from './hooks-http.ts'

export type NodeHttpHandler = (req: IncomingMessage, res: ServerResponse) => void

function notFoundHandler(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not Found')
}

/**
 * Pathname of a Node request target, normalized exactly like the ingress
 * normalizes it (`new URL(req.url).pathname`). The two must agree: when the
 * pre-filter accepts a path the ingress would later decline, the ingress'
 * `null` fall-through would hand the downstream handler an already-drained
 * body. A target Node itself cannot parse never matches the route prefix, so
 * the downstream handler still receives the request untouched.
 */
function requestPathname(url: string | undefined): string {
  try {
    return new URL(url ?? '/', 'http://localhost').pathname
  } catch {
    return ''
  }
}

/** Result of reading a route-prefixed request body under the ingress' cap. */
type BoundedNodeBody = { readonly ok: true; readonly bytes: Buffer | null } | { readonly ok: false }

/**
 * Additional bytes drained (and discarded) once the cap is crossed, so the 413
 * can still be written on a healthy connection. A stream that keeps going past
 * `cap × factor` is abandoned outright: the socket is destroyed instead, which
 * bounds both memory and time for an abusive sender.
 */
const OVERSIZE_DRAIN_FACTOR = 8

/**
 * Read a request body without buffering more than `limitBytes`: the declared
 * `Content-Length` is checked first, and once the running total crosses the
 * limit the remaining stream is drained — never buffered (mirrors
 * `readBoundedBody` in hooks-http.ts for the fetch path).
 */
async function readBoundedNodeBody(nodeReq: IncomingMessage, limitBytes: number): Promise<BoundedNodeBody> {
  if (nodeReq.method === 'GET' || nodeReq.method === 'HEAD') return { ok: true, bytes: null }

  const declared = nodeReq.headers['content-length']
  const declaredBytes = typeof declared === 'string' ? Number(declared) : Number.NaN
  if (Number.isFinite(declaredBytes) && declaredBytes > limitBytes) {
    // Reject from the declared length alone (mirrors readBoundedBody in
    // hooks-http.ts); the caller drains whatever is already in flight.
    return { ok: false }
  }

  const chunks: Buffer[] = []
  let total = 0
  let drained = 0
  for await (const chunk of nodeReq) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    total += bytes.byteLength
    if (total > limitBytes) {
      drained += bytes.byteLength
      if (drained > limitBytes * OVERSIZE_DRAIN_FACTOR) {
        nodeReq.destroy()
        return { ok: false }
      }
      continue
    }
    chunks.push(bytes)
  }
  if (total > limitBytes) return { ok: false }
  return { ok: true, bytes: Buffer.concat(chunks) }
}

async function toWebRequest(nodeReq: IncomingMessage, body: Buffer | null): Promise<Request> {
  // `Socket` only gains `encrypted` on a TLS connection; the doubled cast is
  // the intended narrowing (mirrors webui/node-adapter.ts).
  const socket = nodeReq.socket as unknown as { encrypted?: boolean }
  const protocol = socket.encrypted === true ? 'https' : 'http'
  const host = nodeReq.headers.host ?? 'localhost'
  const url = `${protocol}://${host}${nodeReq.url ?? '/'}`

  const headers = new Headers()
  const raw = nodeReq.rawHeaders
  for (let i = 0; i < raw.length; i += 2) {
    headers.append(raw[i], raw[i + 1])
  }

  // `Request` takes a web `BodyInit`; a raw Node `Buffer` is not assignable to
  // the DOM `ArrayBufferView<ArrayBuffer>` form of that type. Copying the
  // buffer's own view region into a `Uint8Array<ArrayBuffer>` sends the exact
  // same bytes while satisfying both the DOM and Bun `BodyInit` definitions.
  const requestBody = body === null ? null : new Uint8Array(body)

  return new Request(url, { method: nodeReq.method, headers, body: requestBody })
}

async function writeResponse(nodeRes: ServerResponse, response: Response): Promise<void> {
  // `Headers.forEach` yields each value separately, preserving multi-value
  // headers such as Set-Cookie.
  const resHeaders: Record<string, string | string[]> = {}
  response.headers.forEach((value, key) => {
    const existing = resHeaders[key]
    if (existing === undefined) {
      resHeaders[key] = value
    } else if (Array.isArray(existing)) {
      resHeaders[key] = [...existing, value]
    } else {
      resHeaders[key] = [existing, value]
    }
  })
  nodeRes.writeHead(response.status, resHeaders)
  if (response.body) {
    nodeRes.end(Buffer.from(await response.arrayBuffer()))
  } else {
    nodeRes.end()
  }
}

/**
 * Compose the fetch-based hooks ingress with an optional downstream Node HTTP
 * handler (the WebUI). A request the ingress answers (`Response`) is handled
 * here; a request the ingress declines (`null`) — or any request outside its
 * route prefix — is passed to `next`.
 *
 * The ingress' effective body cap is read once from its snapshot so the Node
 * path enforces exactly the same limit the fetch path does.
 *
 * When no ingress is installed (no token configured) this returns `next`
 * unchanged, so the route genuinely does not exist.
 */
export function composeHooksNodeHandler(
  ingress: HooksHttpIngress | null | undefined,
  next?: NodeHttpHandler,
): NodeHttpHandler {
  const downstream = next ?? notFoundHandler
  if (!ingress) return downstream
  const bodyLimitBytes = ingress.snapshot().bodyLimitBytes

  return (nodeReq, nodeRes) => {
    if (!ingress.matches(requestPathname(nodeReq.url))) {
      downstream(nodeReq, nodeRes)
      return
    }
    void (async () => {
      try {
        const body = await readBoundedNodeBody(nodeReq, bodyLimitBytes)
        if (!body.ok) {
          nodeRes.writeHead(413, { 'Content-Type': 'application/json' })
          nodeRes.end(JSON.stringify({ error: 'payload too large' }))
          // Discard (never buffer) whatever is still in flight so the response
          // can flush on a healthy connection; a no-op once the stream ended.
          nodeReq.resume()
          return
        }
        const response = await ingress.handle(await toWebRequest(nodeReq, body.bytes))
        if (!response) {
          downstream(nodeReq, nodeRes)
          return
        }
        await writeResponse(nodeRes, response)
      } catch {
        if (!nodeRes.headersSent) {
          nodeRes.writeHead(500, { 'Content-Type': 'application/json' })
        }
        nodeRes.end(JSON.stringify({ error: 'internal error' }))
      }
    })()
  }
}
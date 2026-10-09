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
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { HooksHttpIngress } from './hooks-http.ts'

export type NodeHttpHandler = (req: IncomingMessage, res: ServerResponse) => void

function notFoundHandler(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not Found')
}

/** Pathname of a Node request target, without parsing the full URL. */
function requestPathname(url: string | undefined): string {
  const target = url ?? '/'
  const query = target.indexOf('?')
  const hash = target.indexOf('#')
  let end = target.length
  if (query !== -1) end = Math.min(end, query)
  if (hash !== -1) end = Math.min(end, hash)
  return target.slice(0, end) || '/'
}

async function toWebRequest(nodeReq: IncomingMessage): Promise<Request> {
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

  let body: Buffer | null = null
  if (nodeReq.method !== 'GET' && nodeReq.method !== 'HEAD') {
    const chunks: Buffer[] = []
    for await (const chunk of nodeReq) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    }
    body = Buffer.concat(chunks)
  }

  return new Request(url, { method: nodeReq.method, headers, body })
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
 * When no ingress is installed (no token configured) this returns `next`
 * unchanged, so the route genuinely does not exist.
 */
export function composeHooksNodeHandler(
  ingress: HooksHttpIngress | null | undefined,
  next?: NodeHttpHandler,
): NodeHttpHandler {
  const downstream = next ?? notFoundHandler
  if (!ingress) return downstream

  return (nodeReq, nodeRes) => {
    if (!ingress.matches(requestPathname(nodeReq.url))) {
      downstream(nodeReq, nodeRes)
      return
    }
    void (async () => {
      try {
        const response = await ingress.handle(await toWebRequest(nodeReq))
        if (!response) {
          downstream(nodeReq, nodeRes)
          return
        }
        await writeResponse(nodeRes, response)
      } catch (error) {
        if (!nodeRes.headersSent) {
          nodeRes.writeHead(500, { 'Content-Type': 'application/json' })
        }
        nodeRes.end(JSON.stringify({ error: 'internal error' }))
      }
    })()
  }
}
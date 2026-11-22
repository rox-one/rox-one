/**
 * Serve the built Solid application.
 *
 * The app is built into `apps/cloud-api/public/app` by
 * `apps/cloud-web` (Vite, `base: "/"`). Everything the browser needs is either
 * a fingerprinted file under `/assets/` or the single `index.html` shell; the
 * client router then owns the address.
 *
 * Contract:
 * - GET and HEAD only; every other method returns `null` so the API answers.
 * - `/v1/*`, `/health` and anything unknown return `null` — this module never
 *   claims an API path and never invents a page.
 * - `/assets/*` is resolved inside the assets directory after one decode; dot
 *   segments, backslashes and a null byte are refused. Unknown extensions are
 *   served as `application/octet-stream`, never guessed.
 * - `/`, `/pricing`, `/docs`, `/status`, `/console`, `/console/*`, `/admin` and
 *   `/admin/*` return the shell.
 * - Old bookmarks are redirected once: the four `.html` pages to their client
 *   routes and the trailing-slash forms of the client roots to the canonical
 *   no-slash address.
 */
import { join, resolve, sep } from 'node:path'

const APP_DIR = join(import.meta.dir, '..', 'public', 'app')
const ASSETS_DIR = join(APP_DIR, 'assets')
const INDEX_FILE = join(APP_DIR, 'index.html')

/** Old address → canonical client address. One hop, no chain. */
const REDIRECTS: Readonly<Record<string, string>> = {
  '/docs.html': '/docs',
  '/pricing.html': '/pricing',
  '/status.html': '/status',
  '/console/': '/console',
  '/admin/': '/admin',
  '/docs/': '/docs',
  '/pricing/': '/pricing',
  '/status/': '/status',
}

const MIME: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
}

function isClientRoute(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/pricing' ||
    pathname === '/docs' ||
    pathname === '/status' ||
    pathname === '/console' ||
    pathname.startsWith('/console/') ||
    pathname === '/admin' ||
    pathname.startsWith('/admin/')
  )
}

/** A decoded `/assets/…` remainder → an absolute file path, or null when unsafe. */
function resolveAsset(relative: string): string | null {
  if (relative.length === 0) return null
  if (relative.includes('\\') || relative.includes('\0')) return null
  for (const segment of relative.split('/')) {
    if (segment.length === 0 || segment === '.' || segment === '..' || segment.startsWith('.')) {
      return null
    }
  }
  const file = resolve(ASSETS_DIR, relative)
  return file.startsWith(`${ASSETS_DIR}${sep}`) ? file : null
}

function contentType(file: string): string {
  const dot = file.lastIndexOf('.')
  const extension = dot === -1 ? '' : file.slice(dot).toLowerCase()
  return MIME[extension] ?? 'application/octet-stream'
}

async function notFound(): Promise<Response> {
  return new Response('Файл сборки не найден: соберите apps/cloud-web', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

async function serveFile(file: string, method: string, cacheControl: string): Promise<Response> {
  const body = Bun.file(file)
  if (!(await body.exists())) return notFound()
  return new Response(method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'content-type': contentType(file),
      'content-length': String(body.size),
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
    },
  })
}

/**
 * Answer a page or asset request, or `null` when the request belongs to the API.
 * The caller decides the order; `/v1` must keep its own answer.
 */
export async function serveSpa(req: Request): Promise<Response | null> {
  const method = req.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return null

  const { pathname } = new URL(req.url)
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (!decoded.startsWith('/') || decoded.includes('\0')) return null

  const redirect = REDIRECTS[decoded]
  if (redirect !== undefined) {
    return new Response(null, {
      status: 302,
      headers: { location: redirect, 'cache-control': 'no-store' },
    })
  }

  if (decoded.startsWith('/assets/')) {
    const file = resolveAsset(decoded.slice('/assets/'.length))
    if (file === null) return null
    return serveFile(file, method, 'public, max-age=31536000, immutable')
  }

  if (isClientRoute(decoded)) return serveFile(INDEX_FILE, method, 'no-cache')

  return null
}

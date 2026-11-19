#!/usr/bin/env bun
/**
 * Entry point for Rox Cloud: the customer API, the staff panel API, the
 * support front (customer tickets and the public `/status` page) and the two
 * pages that drive them, on one origin.
 *
 * Bootstrap contract:
 * - `ROX_BOOTSTRAP_KEY` (a full `rox_sk_live_…`) creates the first tenant and
 *   its key when the process starts with an empty store;
 * - `ROX_MASTER_KEY` (base64, exactly 32 bytes) and
 *   `ROX_PLATFORM_RATE_CENTS_PER_HOUR` (integer > 0) switch the service from
 *   the honest stub to the real runtime: customer provider keys, a reserved
 *   platform fee, the kill switch and the audit trail;
 * - `ROX_BOOTSTRAP_BALANCE_CENTS` pays that first tenant's wallet once;
 * - `ROX_ADMIN_KEY` opens the staff panel under `/admin/`; without it the
 *   panel API answers 404 rather than inventing a default password;
 * - `ROX_CORS_ORIGIN` (comma-separated) allows extra browser origins; empty
 *   means same-origin only.
 *
 * Without the master key and the rate the API still answers every route: the
 * stub provider declares no operating systems and raises
 * `capability_unavailable` for every call, so a pilot deployment cannot
 * silently pretend to boot machines.
 *
 * Nothing in this file prints a secret: the bootstrap key leaves the process
 * only as a hash, and the master key, provider keys and staff key are never
 * logged.
 */

import { join } from 'node:path'

import { MASTER_KEY_BYTES, createMemoryKeyStore } from '../../../packages/cloud-keys/src/index.ts'
import { createAuditLog, createKillSwitch } from '../../../packages/cloud-ops/src/index.ts'
import { createMemoryMoneyStore } from '../../../packages/cloud-runner/src/entitlement.ts'
import type { SandboxProvider } from '../../../packages/cloud-runner/src/sandbox.ts'
import { capabilityUnavailable } from '../../../packages/cloud-runner/src/sandbox.ts'
import { createAdminApp } from './admin.ts'
import { createApp } from './app.ts'
import type { CloudApp, DeclaredCapabilities } from './app.ts'
import { createRuntime, ensureBootstrapBalance, ensureBootstrapKey } from './integration.ts'
import { createMeter } from './meter.ts'
import { createMemoryStore, nextId } from './store.ts'
import { createSupport, supportRouteKind } from './support.ts'
import type { SupportApp } from './support.ts'

const STUB_ID = 'stub'

/** Everything the panel offers. Fixed list: no path is ever built from a request. */
const CONSOLE_DIR = join(import.meta.dir, '..', '..', 'cloud-console')
const SITE_DIR = join(import.meta.dir, '..', '..', 'cloud-site')
const PUBLIC_DIR = join(import.meta.dir, '..', 'public')

const STATIC_FILES: Readonly<Record<string, { readonly file: string; readonly type: string }>> = {
  '/': { file: join(SITE_DIR, 'index.html'), type: 'text/html; charset=utf-8' },
  '/index.html': { file: join(SITE_DIR, 'index.html'), type: 'text/html; charset=utf-8' },
  '/docs.html': { file: join(SITE_DIR, 'docs.html'), type: 'text/html; charset=utf-8' },
  '/pricing.html': { file: join(SITE_DIR, 'pricing.html'), type: 'text/html; charset=utf-8' },
  '/status.html': { file: join(SITE_DIR, 'status.html'), type: 'text/html; charset=utf-8' },
  '/styles.css': { file: join(SITE_DIR, 'styles.css'), type: 'text/css; charset=utf-8' },
  '/console/': { file: join(CONSOLE_DIR, 'index.html'), type: 'text/html; charset=utf-8' },
  '/console/app.js': { file: join(CONSOLE_DIR, 'app.js'), type: 'text/javascript; charset=utf-8' },
  '/console/styles.css': { file: join(CONSOLE_DIR, 'styles.css'), type: 'text/css; charset=utf-8' },
  '/admin/': { file: join(PUBLIC_DIR, 'admin.html'), type: 'text/html; charset=utf-8' },
}

/** Redirects that keep the console and the panel reachable without a slash. */
const REDIRECTS: Readonly<Record<string, string>> = {
  '/console': '/console/',
  '/admin': '/admin/',
}

/**
 * Extra browser origins allowed by CORS; empty means same-origin only. Read on
 * each preflight rather than once, so a test or a restart-by-env both work.
 */
function allowedOrigins(): readonly string[] {
  return (process.env.ROX_CORS_ORIGIN ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

const CORS_ALLOW_HEADERS = 'authorization, content-type, idempotency-key'
const CORS_ALLOW_METHODS = 'GET,POST,PUT,DELETE,OPTIONS'
const CORS_MAX_AGE = '600'

/** Stand-in provider: honest about not being able to do anything yet. */
function createStubProvider(): SandboxProvider {
  return {
    providerId: STUB_ID,
    async create() {
      throw capabilityUnavailable(STUB_ID, 'sandboxes')
    },
    async get() {
      throw capabilityUnavailable(STUB_ID, 'get')
    },
    async exec() {
      throw capabilityUnavailable(STUB_ID, 'exec')
    },
    async readFile() {
      throw capabilityUnavailable(STUB_ID, 'readFile')
    },
    async writeFile() {
      throw capabilityUnavailable(STUB_ID, 'writeFile')
    },
    async stop() {
      throw capabilityUnavailable(STUB_ID, 'stop')
    },
    async destroy() {
      throw capabilityUnavailable(STUB_ID, 'destroy')
    },
  }
}

const STUB_CAPABILITIES: DeclaredCapabilities = {
  id: STUB_ID,
  os: [],
  gpu: false,
  pause: false,
  snapshot: false,
  volume: false,
  streaming: 'none',
  maxTtlSec: 0,
  regions: [],
}

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ error: { type: 'not_found_error', code, message, request_id: nextId('req_') } }),
    { status, headers: { 'content-type': 'application/json; charset=utf-8' } },
  )
}

/**
 * Serve the two pages and their assets.
 *
 * Only the named paths are answered: the map is the whole allowlist, so a
 * request cannot describe a file outside it. A dot segment is refused up front
 * as well, and the decoded path — not the raw one — is what gets looked up.
 * Returns `null` when the request belongs to an API route.
 */
export async function serveStatic(req: Request): Promise<Response | null> {
  const method = req.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return null
  const { pathname } = new URL(req.url)

  const redirect = REDIRECTS[pathname]
  if (redirect !== undefined) {
    return new Response(null, { status: 302, headers: { location: redirect } })
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return errorResponse(404, 'not_found', 'Такого адреса нет')
  }
  if (decoded.includes('..')) return errorResponse(404, 'not_found', 'Такого адреса нет')

  const entry = STATIC_FILES[decoded]
  if (entry === undefined) return null

  const file = Bun.file(entry.file)
  if (!(await file.exists())) {
    return errorResponse(404, 'not_found', 'Файл страницы не найден в этой сборке')
  }
  return new Response(method === 'HEAD' ? null : file, {
    status: 200,
    headers: {
      'content-type': entry.type,
      'content-length': String(file.size),
    },
  })
}

/** Echo one allowed origin back, never a wildcard and never an unlisted one. */
function withCors(req: Request, response: Response): Response {
  const origin = req.headers.get('origin')
  if (origin === null || !allowedOrigins().includes(origin)) return response
  response.headers.set('access-control-allow-origin', origin)
  response.headers.set('vary', 'origin')
  response.headers.set('access-control-allow-headers', CORS_ALLOW_HEADERS)
  response.headers.set('access-control-allow-methods', CORS_ALLOW_METHODS)
  response.headers.set('access-control-max-age', CORS_MAX_AGE)
  return response
}

/** The apps the one origin front door offers. */
export interface HandlerDeps {
  readonly app: { handle(req: Request): Promise<Response> }
  readonly admin: { handle(req: Request): Promise<Response> }
  /**
   * Support front: the ticket routes, the public `/status` page and the staff
   * support routes. Absent means those paths are not served at all — the
   * customer app answers 404 for them, exactly as it did before.
   */
  readonly support?: SupportApp
}

/**
 * One origin, four front doors, in this order: preflight, the static pages,
 * the support routes, then `/admin/` and everything else. Exported so the
 * routing can be exercised without binding a port.
 */
export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method.toUpperCase() === 'OPTIONS') {
      return withCors(req, new Response(null, { status: 204 }))
    }
    const page = await serveStatic(req)
    if (page !== null) return withCors(req, page)
    const { pathname } = new URL(req.url)
    if (deps.support !== undefined) {
      // `app.ts` keeps its own route table, so the support paths are claimed
      // here before the customer app and the staff panel get the request.
      const kind = supportRouteKind(pathname)
      if (kind === 'staff') return withCors(req, await deps.support.adminRoutes.handle(req))
      if (kind === 'customer') return withCors(req, await deps.support.customerRoutes.handle(req))
    }
    const response =
      pathname === '/admin' || pathname.startsWith('/admin/')
        ? await deps.admin.handle(req)
        : await deps.app.handle(req)
    return withCors(req, response)
  }
}

function readMasterKey(): Uint8Array | undefined {
  const raw = (process.env.ROX_MASTER_KEY ?? '').trim()
  if (raw.length === 0) return undefined
  const bytes = Buffer.from(raw, 'base64')
  if (bytes.byteLength !== MASTER_KEY_BYTES) {
    throw new Error(
      `ROX_MASTER_KEY должен быть base64 ровно от ${MASTER_KEY_BYTES} байт, получено ${bytes.byteLength}`,
    )
  }
  return new Uint8Array(bytes)
}

function readRateCentsPerHour(): number | undefined {
  const raw = (process.env.ROX_PLATFORM_RATE_CENTS_PER_HOUR ?? '').trim()
  if (raw.length === 0) return undefined
  const rate = Number(raw)
  if (!Number.isInteger(rate) || rate <= 0) {
    throw new Error(
      `ROX_PLATFORM_RATE_CENTS_PER_HOUR должен быть целым числом больше нуля, получено: ${raw}`,
    )
  }
  return rate
}

function readStartingBalance(): number | undefined {
  const raw = (process.env.ROX_BOOTSTRAP_BALANCE_CENTS ?? '').trim()
  if (raw.length === 0) return undefined
  const cents = Number(raw)
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error(
      `ROX_BOOTSTRAP_BALANCE_CENTS должен быть целым числом больше нуля, получено: ${raw}`,
    )
  }
  return cents
}

function readPort(): number {
  const port = Number(process.env.PORT ?? 8787)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT должен быть целым числом от 1 до 65535, получено: ${process.env.PORT}`)
  }
  return port
}

/**
 * Boot the process: one origin, four front doors.
 *
 * `handle` is the whole router — preflight, then the pages, then the support
 * routes, then `/admin/` and everything else. Kept out of the module body so
 * importing this file (for its static handler) never binds a port.
 */
function main() {
  const port = readPort()

  const store = createMemoryStore()

  const bootstrapKey = (process.env.ROX_BOOTSTRAP_KEY ?? '').trim()
  const bootstrapTenantName = (process.env.ROX_BOOTSTRAP_TENANT ?? '').trim() || 'Моя команда'
  let bootstrapTenantId: string | undefined
  if (bootstrapKey.length > 0) {
    const boot = ensureBootstrapKey(store, { key: bootstrapKey, tenantName: bootstrapTenantName })
    if (boot.created && boot.tenant !== undefined) {
      bootstrapTenantId = boot.tenant.id
      console.log(`Создан первый арендатор «${bootstrapTenantName}» по ROX_BOOTSTRAP_KEY`)
    }
  }

  const masterKey = readMasterKey()
  const rateCentsPerHour = readRateCentsPerHour()
  const startingBalanceCents = readStartingBalance()
  const adminKey = (process.env.ROX_ADMIN_KEY ?? '').trim()

  // Persistence is in memory in this slice: a restart forgets tenants, keys,
  // wallets and sandboxes alike.
  const keyStore = createMemoryKeyStore()
  const moneyStore = createMemoryMoneyStore()
  const audit = createAuditLog()
  const killSwitch = createKillSwitch()

  let app: CloudApp
  let stopResource: (tenantId: string, sandboxId: string) => Promise<void>

  if (masterKey !== undefined && rateCentsPerHour !== undefined) {
    const runtime = createRuntime({
      store,
      keyStore,
      moneyStore,
      audit,
      killSwitch,
      masterKey,
      rateCentsPerHour,
    })

    if (bootstrapTenantId !== undefined && startingBalanceCents !== undefined) {
      ensureBootstrapBalance(moneyStore, bootstrapTenantId, startingBalanceCents, Date.now())
      console.log(`Первый арендатор пополнен на ${startingBalanceCents} центов по ROX_BOOTSTRAP_BALANCE_CENTS`)
    }

    app = createApp({
      store,
      resolveProvider: runtime.resolveProvider,
      listCapabilities: runtime.listCapabilities,
      defaultProvider: 'daytona',
      beforeCreate: runtime.beforeCreate,
      afterStop: runtime.afterStop,
      afterDestroy: runtime.afterDestroy,
      keyStore,
      masterKey,
      moneyStore,
      rateCentsPerHour,
    })

    /** Staff stop: same three steps the customer route takes, on any tenant. */
    stopResource = async (tenantId, sandboxId) => {
      const record = store.sandboxes.get(sandboxId)
      if (!record || record.tenantId !== tenantId) {
        throw new Error('Машина не найдена у этого арендатора')
      }
      const provider = await runtime.resolveProvider(tenantId, record.providerId)
      if (!provider) {
        throw new Error(`У арендатора больше нет ключа для провайдера «${record.providerId}»`)
      }
      await provider.stop(record.id)
      record.state = 'stopped'
      await runtime.afterStop({
        tenantId,
        sandboxId: record.id,
        startedAt: record.startedAt ?? record.createdAt,
        stoppedAt: Date.now(),
      })
    }
    console.log(
      `Rox Cloud: исполнение включено, ставка ${rateCentsPerHour} центов в час, провайдер daytona`,
    )
  } else {
    const stub = createStubProvider()
    app = createApp({
      store,
      resolveProvider: (_tenantId, providerId) => (providerId === STUB_ID ? stub : null),
      listCapabilities: () => [STUB_CAPABILITIES],
      defaultProvider: STUB_ID,
    })
    // No control plane means no provider adapter to stop anything through; the
    // panel says so instead of pretending the button worked.
    stopResource = async () => {
      throw new Error('Исполнение не настроено: нужны ROX_MASTER_KEY и ROX_PLATFORM_RATE_CENTS_PER_HOUR')
    }
    console.log(
      'Rox Cloud: исполнение не настроено — нужны ROX_MASTER_KEY и ROX_PLATFORM_RATE_CENTS_PER_HOUR, работает заглушка',
    )
  }

  // The console shows a rising cost, so the meter must tick even when nobody
  // asks for the list. `unref` keeps the process free to exit in tests.
  if (rateCentsPerHour !== undefined) {
    const meter = createMeter({ store, rateCentsPerHour })
    const timer = setInterval(() => meter.tick(), 30_000)
    timer.unref?.()
  }

  // One staff key or none: `adminKey` stays `undefined` when the variable is
  // empty, and the panel API then answers 404 on every route.
  const admin = createAdminApp({
    store,
    keyStore,
    moneyStore,
    audit,
    killSwitch,
    ...(adminKey.length > 0 ? { adminKey } : {}),
    stopResource,
  })

  // Support shares the control-plane store (customer keys are verified there)
  // and the same audit trail and staff key as the panel: a ticket answered in
  // the panel and the same ticket in the customer's console are one record.
  const support = createSupport({
    store,
    audit,
    ...(adminKey.length > 0 ? { adminKey } : {}),
  })

  if (adminKey.length === 0) {
    console.log('Rox Cloud: панель дежурного выключена — задайте ROX_ADMIN_KEY, чтобы включить /admin/')
  }

  const server = Bun.serve({ port, fetch: createHandler({ app, admin, support }) })
  console.log(`Rox Cloud API слушает порт ${server.port}`)
  return server
}

export const server = import.meta.main ? main() : undefined

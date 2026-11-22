#!/usr/bin/env bun
/**
 * Entry point for Rox Cloud: the customer API, the staff JSON API, the support
 * front and one Solid application (site, console, staff panel) on one origin.
 *
 * Bootstrap contract:
 * - `ROX_BOOTSTRAP_KEY` (a full `rox_sk_live_…`) creates the first tenant and
 *   its key when the process starts with an empty store;
 * - `ROX_MASTER_KEY` (base64, exactly 32 bytes) and
 *   `ROX_PLATFORM_RATE_CENTS_PER_HOUR` (integer > 0) switch the service from
 *   the honest stub to the real runtime: provider keys, a wallet, the kill
 *   switch and the audit trail. The published price list then prices each
 *   machine by its shape; the flat rate is the fallback for old records;
 * - `ROX_BOOTSTRAP_BALANCE_CENTS` pays that first tenant's wallet once;
 * - `ROX_ADMIN_KEY` opens the staff JSON API under `/v1/admin/*`; without it
 *   the API answers 404 rather than inventing a default password. The panel
 *   page at `/admin` is the built app and needs the key typed in;
 * - `ROX_PLATFORM_DAYTONA_KEY` (fallback `DAYTONA_API_KEY`) lets the platform
 *   sell managed machines; without it only a tenant's own key can boot;
 * - `ROX_GUEST_ENABLED=1` opens `POST /v1/guest`: a trial tenant, one key and
 *   `ROX_GUEST_TRIAL_CENTS` (default 2000) of credit, rate-limited by address;
 * - `ROX_DEMO_TENANT_ID` turns on `POST /v1/demo` for one tenant whose own
 *   provider key pays for the runs;
 * - `ROX_CORS_ORIGIN` (comma-separated) allows extra browser origins; empty
 *   means same-origin only;
 * - `ROX_STATE_FILE` makes the process durable: the snapshot is read back
 *   before boot, written after every change, and a damaged file stops the boot.
 *
 * On SIGINT and SIGTERM with a state file configured, every live machine is
 * stopped (its wallet settled) and the state is saved once; a second signal,
 * or fifteen seconds, ends the process regardless. A machine past `expiresAt`
 * is stopped by the 30-second reaper even when no signal arrives.
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

import { MASTER_KEY_BYTES, createMemoryKeyStore } from '../../../packages/cloud-keys/src/index.ts'
import { createAuditLog, createKillSwitch } from '../../../packages/cloud-ops/src/index.ts'
import { createMemoryMoneyStore, release } from '../../../packages/cloud-runner/src/entitlement.ts'
import type { AccountLimits } from '../../../packages/cloud-runner/src/limits.ts'
import type { SandboxProvider } from '../../../packages/cloud-runner/src/sandbox.ts'
import { capabilityUnavailable } from '../../../packages/cloud-runner/src/sandbox.ts'
import { createAdminApp } from './admin.ts'
import { createApp, DEFAULT_PRICE_SHEET } from './app.ts'
import type { CloudApp, DeclaredCapabilities } from './app.ts'
import { hashApiKey } from './auth.ts'
import { createDemo } from './demo.ts'
import { createRuntime, ensureBootstrapBalance, ensureBootstrapKey } from './integration.ts'
import { createMeter } from './meter.ts'
import { applyState, loadState, saveState, snapshotState } from './persistence.ts'
import {
  createPlatformProvider,
  managedProviders,
  platformKeyLast4,
  platformProviders,
} from './platform.ts'
import { serveSpa } from './spa.ts'
import { createMemoryStore, nextId } from './store.ts'
import type { RequestLogRow } from './store.ts'
import { createSupport, supportRouteKind } from './support.ts'
import type { SupportApp } from './support.ts'

const STUB_ID = 'stub'

/**
 * Per-account ceilings: enforced by the boot path and printed by the panel from
 * the one object, so the two can never disagree. Zeros mean «не ограничено» —
 * in the pilot the wallet is the only ceiling until an operator sets one.
 */
const ACCOUNT_LIMITS: AccountLimits = {
  maxConcurrentSandboxes: 0,
  maxCpuPerSandbox: 0,
  maxMonthlyCents: 0,
}

/**
 * The address Bun saw for a request, attached at the socket boundary. The
 * customer app cannot read a socket itself, and the guest limiter and the
 * front-door journal both need the real caller, not a bearer key.
 */
const ipByRequest = new WeakMap<Request, string>()

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

/** The proxy-aware caller address, used when Bun's socket map is unavailable. */
function forwardedIp(req: Request): string | undefined {
  const forwarded = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim()
  if (forwarded !== undefined && forwarded.length > 0) return forwarded
  const real = (req.headers.get('x-real-ip') ?? '').trim()
  return real.length > 0 ? real : undefined
}

const CORS_ALLOW_HEADERS = 'authorization, content-type, idempotency-key'
const CORS_ALLOW_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
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

/**
 * Echo one allowed origin back, never a wildcard and never an unlisted one.
 */
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
   * Support front: the ticket routes, the public `/v1/status` view and the
   * staff support routes. Absent means those paths are not served at all.
   */
  readonly support?: SupportApp
  /**
   * The public demo front door. Absent means `/v1/demo` closes politely with
   * `demo_unavailable` instead of falling through to the authenticated API.
   */
  readonly demo?: { handle(req: Request): Promise<Response> }
  /**
   * Front-door journal for calls the customer app does not handle itself:
   * staff, support and the demo. The app records its own calls with the
   * verified tenant, so the two writers never duplicate a row.
   */
  readonly recordRequest?: (row: RequestLogRow) => void
  /** Resolve a presented key to its tenant, without ever storing the key. */
  readonly lookupTenant?: (key: string) => string | undefined
  /** Client address from Bun's socket or a proxy header, for the journal. */
  readonly clientIp?: (req: Request) => string | undefined
}

/** The bearer secret as presented, or `undefined`; never logged as a whole. */
function presentedKey(req: Request): string | undefined {
  const match = /^bearer\s+(.+)$/i.exec((req.headers.get('authorization') ?? '').trim())
  return match?.[1]?.trim()
}

/**
 * The demo is off in this deployment: the page exists, the machine does not.
 * Answered here, before the customer app, so the visitor never sees a 404 that
 * reads like a typo in the address.
 */
function demoUnavailable(): Response {
  return new Response(
    JSON.stringify({
      error: {
        type: 'service_unavailable_error',
        code: 'demo_unavailable',
        message: 'Пробная машина не настроена: владелец ещё не добавил ключ поставщика',
        request_id: nextId('req_'),
      },
    }),
    { status: 503, headers: { 'content-type': 'application/json; charset=utf-8' } },
  )
}

/**
 * One origin, in this order: preflight, the built Solid app, the public demo,
 * the support routes, the staff JSON API under `/v1/admin`, then the customer
 * API. `/admin/*` and `/status` are the app's pages; `/v1/admin/*` and
 * `/v1/status` are JSON. Exported so the routing can be exercised without
 * binding a port.
 */
export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method.toUpperCase() === 'OPTIONS') {
      return withCors(req, new Response(null, { status: 204 }))
    }
    const startedAt = Date.now()
    const page = await serveSpa(req)
    if (page !== null) return withCors(req, page)

    const { pathname } = new URL(req.url)
    const finish = (response: Response): Response => {
      try {
        if (deps.recordRequest !== undefined) {
          const key = presentedKey(req)
          const tenantId = key === undefined ? undefined : deps.lookupTenant?.(key)
          const ip = deps.clientIp?.(req)
          const requestId = response.headers.get('x-request-id') ?? undefined
          deps.recordRequest({
            at: startedAt,
            method: req.method.toUpperCase(),
            path: pathname,
            status: response.status,
            durationMs: Math.max(0, Date.now() - startedAt),
            ...(tenantId === undefined ? {} : { tenantId }),
            ...(key === undefined ? {} : { keyLast4: key.slice(-4) }),
            ...(ip === undefined ? {} : { ip }),
            ...(requestId === undefined ? {} : { requestId }),
          })
        }
      } catch {
        // The journal is diagnostics; the response is the contract.
      }
      return withCors(req, response)
    }

    // The demo is public and lives in front of the key-authenticated routes.
    if (pathname === '/v1/demo') {
      return finish(deps.demo !== undefined ? await deps.demo.handle(req) : demoUnavailable())
    }
    if (deps.support !== undefined) {
      // `app.ts` keeps its own route table, so the support paths are claimed
      // here before the customer app and the staff panel get the request.
      const kind = supportRouteKind(pathname)
      if (kind === 'staff') return finish(await deps.support.adminRoutes.handle(req))
      if (kind === 'customer') return finish(await deps.support.customerRoutes.handle(req))
    }
    if (pathname === '/v1/admin' || pathname.startsWith('/v1/admin/')) {
      return finish(await deps.admin.handle(req))
    }
    // The customer app records its own calls, with the verified tenant; the
    // front door only adds staff, support and demo calls to the same ring.
    return withCors(req, await deps.app.handle(req))
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

/** A positive integer environment value, or the documented default. */
function readPositiveInt(name: string, fallback: number): number {
  const raw = (process.env[name] ?? '').trim()
  if (raw.length === 0) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} должен быть целым числом больше нуля, получено: ${raw}`)
  }
  return value
}

function readPort(): number {
  const port = Number(process.env.PORT ?? 8787)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT должен быть целым числом от 1 до 65535, получено: ${process.env.PORT}`)
  }
  return port
}

/** Text of a thrown value without assuming it is an `Error`. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Boot the process: one origin, four front doors.
 *
 * `handle` is the whole router — preflight, then the pages, then the support
 * routes, then `/admin/` and everything else. Kept out of the module body so
 * importing this file (for its static handler) never binds a port.
 */
async function main() {
  const port = readPort()

  // The state file is the only durable surface. When it is set the previous
  // snapshot is read before any store exists, so a restart keeps tenants, key
  // hashes, wallets, provider keys and the staff trail. A damaged file stops
  // the boot instead of opening an empty deployment.
  const stateFile = (process.env.ROX_STATE_FILE ?? '').trim()
  const restored = stateFile.length > 0 ? await loadState(stateFile) : undefined

  const store = createMemoryStore()

  const masterKey = readMasterKey()
  const rateCentsPerHour = readRateCentsPerHour()
  const startingBalanceCents = readStartingBalance()
  const adminKey = (process.env.ROX_ADMIN_KEY ?? '').trim()

  const keyStore = createMemoryKeyStore()
  const moneyStore = createMemoryMoneyStore()
  const audit = createAuditLog()
  const killSwitch = createKillSwitch()

  const persistence =
    stateFile.length > 0
      ? { file: stateFile, deps: { store, moneyStore, keyStore, audit, killSwitch } }
      : undefined

  if (restored !== undefined && persistence !== undefined) {
    applyState(restored, persistence.deps)
    console.log(
      `Rox Cloud: состояние восстановлено из ${stateFile} — арендаторов ${store.tenants.size}, машин ${store.sandboxes.size}`,
    )
  }

  const bootstrapKey = (process.env.ROX_BOOTSTRAP_KEY ?? '').trim()
  const bootstrapTenantName = (process.env.ROX_BOOTSTRAP_TENANT ?? '').trim() || 'Моя команда'
  let bootstrapTenantId: string | undefined
  if (bootstrapKey.length > 0) {
    // `ensureBootstrapKey` leaves a restored store alone: it adds the first key
    // only when no key exists yet.
    const boot = ensureBootstrapKey(store, { key: bootstrapKey, tenantName: bootstrapTenantName })
    if (boot.created && boot.tenant !== undefined) {
      bootstrapTenantId = boot.tenant.id
      console.log(`Создан первый арендатор «${bootstrapTenantName}» по ROX_BOOTSTRAP_KEY`)
    }
  }

  let app: CloudApp
  let stopResource: (tenantId: string, sandboxId: string) => Promise<void>
  // Shared by the customer API and the demo: one lookup, so the demo runs only
  // while the demo tenant's own credential is present and usable.
  let resolveProvider: (tenantId: string, providerId: string) => Promise<SandboxProvider | null>

  if (masterKey !== undefined && rateCentsPerHour !== undefined) {
    const runtime = createRuntime({
      store,
      keyStore,
      moneyStore,
      audit,
      killSwitch,
      masterKey,
      rateCentsPerHour,
      limits: ACCOUNT_LIMITS,
      platformProvider: (providerId) => createPlatformProvider(providerId),
      ...(process.env.ROX_MODAL_BRIDGE_URL
        ? { modalBridgeUrl: process.env.ROX_MODAL_BRIDGE_URL.trim() }
        : {}),
      ...(process.env.ROX_E2B_TEMPLATE
        ? { e2bTemplate: process.env.ROX_E2B_TEMPLATE.trim() }
        : {}),
      ...(process.env.ROX_E2B_SANDBOX_HOST
        ? { e2bSandboxHost: process.env.ROX_E2B_SANDBOX_HOST.trim() }
        : {}),
    })

    if (bootstrapTenantId !== undefined && startingBalanceCents !== undefined) {
      ensureBootstrapBalance(moneyStore, bootstrapTenantId, startingBalanceCents, Date.now())
      console.log(`Первый арендатор пополнен на ${startingBalanceCents} центов по ROX_BOOTSTRAP_BALANCE_CENTS`)
    }

    resolveProvider = runtime.resolveProvider

    const guestEnabled = ['1', 'true', 'yes'].includes(
      (process.env.ROX_GUEST_ENABLED ?? '').trim().toLowerCase(),
    )
    const guestTrialCents = readPositiveInt('ROX_GUEST_TRIAL_CENTS', 2000)

    app = createApp({
      store,
      resolveProvider: runtime.resolveProvider,
      resolveLease: runtime.resolveLease,
      listCapabilities: runtime.listCapabilities,
      defaultProvider: 'daytona',
      beforeCreate: runtime.beforeCreate,
      afterStop: runtime.afterStop,
      afterDestroy: runtime.afterDestroy,
      keyStore,
      masterKey,
      moneyStore,
      rateCentsPerHour,
      pricing: DEFAULT_PRICE_SHEET,
      managedProviders,
      guest: { enabled: guestEnabled, trialCents: guestTrialCents },
      guestClientIp: (req) => ipByRequest.get(req) ?? forwardedIp(req),
      audit,
    })

    /** Staff stop: same three steps the customer route takes, on any tenant. */
    stopResource = async (tenantId, sandboxId) => {
      const record = store.sandboxes.get(sandboxId)
      if (!record || record.tenantId !== tenantId) {
        throw new Error('Машина не найдена у этого арендатора')
      }
      // A managed machine has no tenant credential; the lease resolver is the
      // one place that knows which key pays for it.
      const lease = await runtime.resolveLease(tenantId, record.providerId)
      if (!lease) {
        throw new Error(`Нет ключа для провайдера «${record.providerId}»: ни своего, ни платформенного`)
      }
      await lease.provider.stop(record.id)
      record.state = 'stopped'
      await runtime.afterStop({
        tenantId,
        sandboxId: record.id,
        startedAt: record.startedAt ?? record.createdAt,
        stoppedAt: Date.now(),
        ...(record.rateCentsPerHour === undefined
          ? {}
          : { rateCentsPerHour: record.rateCentsPerHour }),
      })
    }
    console.log(
      `Rox Cloud: исполнение включено, ставка ${rateCentsPerHour} центов в час, провайдер daytona`,
    )
  } else {
    const stub = createStubProvider()
    resolveProvider = async (_tenantId, providerId) => (providerId === STUB_ID ? stub : null)
    app = createApp({
      store,
      resolveProvider,
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

  // The demo tenant is an explicit choice, never a guess: without
  // `ROX_DEMO_TENANT_ID` the page is still served and `/v1/demo` answers
  // `demo_unavailable`, so a pilot cannot hand out machines by accident.
  const demoTenantId = (process.env.ROX_DEMO_TENANT_ID ?? '').trim()
  const demo =
    demoTenantId.length > 0
      ? createDemo({
          store,
          tenantId: demoTenantId,
          rateCentsPerHour: rateCentsPerHour ?? 0,
          resolveProvider,
        })
      : undefined
  console.log(
    demoTenantId.length > 0
      ? 'Rox Cloud: пробная страница включена — одна попытка с адреса в сутки'
      : 'Rox Cloud: пробная страница выключена — задайте ROX_DEMO_TENANT_ID, чтобы включить /v1/demo',
  )

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
    limits: ACCOUNT_LIMITS,
    ...(adminKey.length > 0 ? { adminKey } : {}),
    platformKeys: () =>
      platformProviders().map((provider) => ({
        provider,
        last4: platformKeyLast4(provider),
      })),
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
    console.log('Rox Cloud: панель дежурного выключена — задайте ROX_ADMIN_KEY, чтобы включить /v1/admin')
  }

  /**
   * Run one write behind the chain, so two writers can never race for the same
   * `.tmp` sibling. The chain itself always resolves: a failed write is logged
   * and leaves `lastFingerprint` empty, so the next change tries again.
   */
  let lastFingerprint: string | null = null
  let writeChain: Promise<void> = Promise.resolve()
  const queueWrite = (work: () => Promise<void>): Promise<void> => {
    const run = writeChain.then(work)
    writeChain = run.catch((error: unknown) => {
      lastFingerprint = null
      console.error(
        `Rox Cloud: не удалось сохранить состояние в ${persistence?.file}: ${messageOf(error)}`,
      )
    })
    return run
  }

  /**
   * Write the state after a request, and only when the snapshot actually
   * changed. `savedAt` is the time of this snapshot, so it is blanked before
   * the comparison — otherwise every request would look like a change.
   */
  const persistIfChanged = (): Promise<void> => {
    if (persistence === undefined) return Promise.resolve()
    return queueWrite(async () => {
      const state = snapshotState(persistence.deps)
      const fingerprint = JSON.stringify({ ...state, savedAt: '' })
      if (fingerprint === lastFingerprint) return
      await saveState(persistence.file, state)
      lastFingerprint = fingerprint
    }).then(
      () => undefined,
      // A lost write must not fail the request that produced it — the answer
      // already reflects the in-memory state — and the chain has logged it.
      () => undefined,
    )
  }

  const handler = createHandler({
    app,
    admin,
    support,
    recordRequest: (row) => store.recordRequest(row),
    lookupTenant: (key) => store.findApiKeyByHash(hashApiKey(key))?.tenantId,
    clientIp: (req) => ipByRequest.get(req) ?? forwardedIp(req),
    ...(demo !== undefined ? { demo } : {}),
  })

  // A deadline is not decoration: every 30 seconds a machine past `expiresAt`
  // is stopped through the ordinary staff path, which settles its wallet and
  // updates its invoice line. One reaper at a time; a slow vendor stop must not
  // overlap the next tick.
  if (masterKey !== undefined && rateCentsPerHour !== undefined) {
    let reaping = false
    const reaper = setInterval(() => {
      if (reaping) return
      reaping = true
      void (async () => {
        try {
          const at = Date.now()
          for (const record of [...store.sandboxes.values()]) {
            if (record.expiresAt === undefined || record.expiresAt > at) continue
            if (
              record.state !== 'queued' &&
              record.state !== 'starting' &&
              record.state !== 'running' &&
              record.state !== 'paused'
            ) {
              continue
            }
            try {
              await stopResource(record.tenantId, record.id)
              console.log(`Rox Cloud: машина ${record.id} остановлена по сроку жизни`)
            } catch (error) {
              console.error(
                `Rox Cloud: не удалось остановить ${record.id} по сроку: ${messageOf(error)}`,
              )
            }
          }
          await persistIfChanged()
        } finally {
          reaping = false
        }
      })()
    }, 30_000)
    reaper.unref?.()
  }

  if (persistence !== undefined) {
    // Leaving a machine `running` in a file nobody can stop would strand the
    // customer's money on a hold: on a signal every live machine is stopped
    // through the same path a staff stop takes, which settles its wallet.
    let signals = 0
    const shutdown = async (signal: string): Promise<void> => {
      signals += 1
      if (signals > 1) {
        console.log(`Rox Cloud: повторный ${signal} — выходим сразу`)
        process.exit(0)
      }
      const watchdog = setTimeout(() => {
        console.error('Rox Cloud: остановка не уложилась в 15 секунд — выходим принудительно')
        process.exit(0)
      }, 15_000)
      watchdog.unref?.()
      for (const record of [...store.sandboxes.values()]) {
        if (record.state === 'stopped' || record.state === 'failed' || record.state === 'expired') {
          continue
        }
        try {
          await stopResource(record.tenantId, record.id)
        } catch (error) {
          record.state = 'failed'
          const held =
            moneyStore.getAccount(record.tenantId) === undefined
              ? undefined
              : moneyStore.findReservation(record.tenantId, record.id)
          if (held !== undefined) release(moneyStore, record.tenantId, record.id, Date.now())
          console.error(
            `Rox Cloud: машину ${record.id} не удалось остановить при выходе — помечена как failed: ${messageOf(error)}`,
          )
        }
      }
      try {
        await queueWrite(() => saveState(persistence.file, snapshotState(persistence.deps)))
        console.log(`Rox Cloud: состояние сохранено в ${persistence.file}`)
      } catch {
        // `queueWrite` has already logged the path and the reason.
      }
      clearTimeout(watchdog)
      process.exit(0)
    }
    process.on('SIGINT', () => {
      void shutdown('SIGINT')
    })
    process.on('SIGTERM', () => {
      void shutdown('SIGTERM')
    })
  }

  const server = Bun.serve({
    port,
    fetch: async (req: Request, bunServer): Promise<Response> => {
      const ip = bunServer.requestIP(req)?.address
      if (ip !== undefined) ipByRequest.set(req, ip)
      const response = await handler(req)
      await persistIfChanged()
      return response
    },
  })
  console.log(`Rox Cloud API слушает порт ${server.port}`)
  return server
}

export const server = import.meta.main
  ? await main().catch((error: unknown) => {
      // A boot that cannot read its own state must not look like a healthy
      // empty deployment: say why and exit non-zero.
      console.error(`Rox Cloud не запустился: ${messageOf(error)}`)
      process.exit(1)
    })
  : undefined

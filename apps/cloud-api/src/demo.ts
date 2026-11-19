/**
 * The public demo: one command, one machine, nothing to sign up for.
 *
 * This is a separate front door from the authenticated API on purpose. It has
 * no API key, no tenant in the request and no wallet: the machine boots under
 * one fixed demo tenant whose provider credential lives in the vault, so a
 * visitor can see a command run and its price without ever holding a secret.
 *
 * What keeps it from becoming free compute:
 * - one run per address per UTC day, counted from `x-forwarded-for` (first
 *   value) or `x-real-ip`;
 * - a 60-second machine lifetime and a 10-second command timeout;
 * - a command of at most 2 KB in a body of at most 8 KB;
 * - nothing is created at all when the demo tenant has no provider key.
 *
 * The response carries the stdout, the exit code, the price in cents and the
 * sandbox id minted here. It never carries the provider id, the provider's own
 * sandbox id or the key: the demo page is public.
 */

import type { SandboxExecResult, SandboxProvider } from '../../../packages/cloud-runner/src/sandbox.ts'
import { nextId } from './store.ts'
import type { MemoryStore } from './store.ts'

// ============================================================
// Limits
// ============================================================

/** The provider the demo asks for; without a key for it the demo is closed. */
export const DEMO_PROVIDER_ID = 'daytona'
export const DEMO_MAX_BODY_BYTES = 8 * 1024
export const DEMO_MAX_COMMAND_BYTES = 2 * 1024
export const DEMO_TTL_SEC = 60
export const DEMO_EXEC_TIMEOUT_MS = 10_000

const MS_PER_HOUR = 3_600_000
const UNKNOWN_ADDRESS = 'unknown'
const MAX_LIMIT_PER_DAY = 10

/** Russian wording a visitor can act on, one string per refusal. */
const MESSAGES = {
  method: 'Пробная страница принимает только POST с полем command',
  body_too_large: 'Тело запроса больше 8 КБ: пришлите одну короткую команду',
  body_empty: 'Тело запроса пустое: нужен объект JSON с полем command',
  body_invalid: 'Тело запроса не является корректным JSON',
  body_object: 'Тело запроса должно быть объектом JSON с полем command',
  command_missing: 'Поле command обязательно: что выполнить в машине',
  command_too_long: 'Команда длиннее 2 КБ: пришлите одну короткую команду',
  limit: 'Пробный запуск уже был сегодня. Следующий — завтра: сутки считаются по UTC',
  unavailable: 'Пробная машина не настроена: владелец ещё не добавил ключ поставщика',
  failed: 'Пробный запуск не удался: машина не ответила',
} as const

// ============================================================
// Options
// ============================================================

export interface DemoOptions {
  /**
   * Same lookup the authenticated API uses, so the demo tenant is only served
   * while its credential is present and usable.
   */
  readonly resolveProvider: (
    tenantId: string,
    providerId: string,
  ) => Promise<SandboxProvider | null> | SandboxProvider | null
  /** Control-plane state; the demo records its spend in the usage ledger. */
  readonly store: MemoryStore
  /** Tenant whose provider key pays for the demo runs. */
  readonly tenantId: string
  /** Platform fee in cents per sandbox-hour, the same rate the account shows. */
  readonly rateCentsPerHour: number
  /** Runs per address per UTC day; defaults to one. */
  readonly limitPerDay?: number
  readonly now?: () => number
}

export interface DemoApp {
  handle(req: Request): Promise<Response>
}

// ============================================================
// Refusals
// ============================================================

/** A refusal with the public envelope's own status, code and family. */
class DemoRefusal extends Error {
  readonly status: number
  readonly code: string
  readonly type: string

  constructor(status: number, type: string, code: string, message: string) {
    super(message)
    this.name = 'DemoRefusal'
    this.status = status
    this.code = code
    this.type = type
  }
}

function errorJson(refusal: DemoRefusal, requestId: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        type: refusal.type,
        code: refusal.code,
        message: refusal.message,
        request_id: requestId,
      },
    }),
    { status: refusal.status, headers: { 'content-type': 'application/json; charset=utf-8' } },
  )
}

const utf8 = new TextEncoder()

// ============================================================
// Demo
// ============================================================

export function createDemo(options: DemoOptions): DemoApp {
  const now = options.now ?? (() => Date.now())
  const limitPerDay = Math.min(
    Math.max(Math.trunc(options.limitPerDay ?? 1), 1),
    MAX_LIMIT_PER_DAY,
  )
  /** Address → the UTC day it was last served on, and how many runs it used. */
  const runs = new Map<string, { day: string; count: number }>()

  /** Who is asking: the proxy's first hop, then the direct address, then nobody. */
  function addressOf(req: Request): string {
    const forwarded = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? ''
    if (forwarded.length > 0) return forwarded
    const real = (req.headers.get('x-real-ip') ?? '').trim()
    return real.length > 0 ? real : UNKNOWN_ADDRESS
  }

  /** Refuses (and does not record) once today's budget for this address is gone. */
  function chargeAddress(address: string, at: number): void {
    const day = new Date(at).toISOString().slice(0, 10)
    const bucket = runs.get(address)
    if (!bucket || bucket.day !== day) {
      runs.set(address, { day, count: 1 })
      return
    }
    if (bucket.count >= limitPerDay) {
      throw new DemoRefusal(429, 'rate_limit_error', 'demo_limit', MESSAGES.limit)
    }
    bucket.count += 1
  }

  async function readCommand(req: Request): Promise<string> {
    const declared = Number(req.headers.get('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > DEMO_MAX_BODY_BYTES) {
      throw new DemoRefusal(413, 'invalid_request_error', 'payload_too_large', MESSAGES.body_too_large)
    }
    const text = await req.text()
    if (utf8.encode(text).byteLength > DEMO_MAX_BODY_BYTES) {
      throw new DemoRefusal(413, 'invalid_request_error', 'payload_too_large', MESSAGES.body_too_large)
    }
    if (text.trim().length === 0) {
      throw new DemoRefusal(400, 'invalid_request_error', 'invalid_request', MESSAGES.body_empty)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new DemoRefusal(400, 'invalid_request_error', 'invalid_request', MESSAGES.body_invalid)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new DemoRefusal(400, 'invalid_request_error', 'invalid_request', MESSAGES.body_object)
    }
    const command = (parsed as Record<string, unknown>).command
    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new DemoRefusal(400, 'invalid_request_error', 'invalid_request', MESSAGES.command_missing)
    }
    if (utf8.encode(command).byteLength > DEMO_MAX_COMMAND_BYTES) {
      throw new DemoRefusal(400, 'invalid_request_error', 'invalid_request', MESSAGES.command_too_long)
    }
    return command
  }

  /** Price of one run: whole cents, at least one, never a fraction. */
  function costCents(elapsedMs: number): number {
    const hours = Math.max(elapsedMs, 0) / MS_PER_HOUR
    return Math.max(1, Math.ceil(hours * options.rateCentsPerHour))
  }

  interface RunOutcome {
    readonly id: string
    readonly result: SandboxExecResult
    readonly elapsedMs: number
  }

  async function runOnce(provider: SandboxProvider, command: string): Promise<RunOutcome> {
    // The id is minted here, so a provider's own id never reaches the visitor.
    const id = nextId('sbx_')
    const startedAt = now()
    await provider.create({
      id,
      os: 'linux',
      cpu: 1,
      memoryGb: 1,
      ttlSec: DEMO_TTL_SEC,
      metadata: { demo: 'true' },
    })
    try {
      const result = await provider.exec(id, command, { timeoutMs: DEMO_EXEC_TIMEOUT_MS })
      return { id, result, elapsedMs: Math.max(0, now() - startedAt) }
    } finally {
      // A failed command must not leave a paid machine running; a destroy that
      // fails is not allowed to hide the command's own outcome either.
      try {
        await provider.destroy(id)
      } catch {
        // The sandbox expires on its own TTL; the visitor still gets an answer.
      }
    }
  }

  async function runRequest(req: Request): Promise<Response> {
    if (req.method.toUpperCase() !== 'POST') {
      throw new DemoRefusal(405, 'invalid_request_error', 'invalid_request', MESSAGES.method)
    }
    const command = await readCommand(req)

    // Nothing boots and no address is charged when the demo has no credential:
    // a visitor is told the machine is not configured, not that they used up
    // their run on a page that could not work.
    const provider = await options.resolveProvider(options.tenantId, DEMO_PROVIDER_ID)
    if (!provider) {
      throw new DemoRefusal(503, 'service_unavailable_error', 'demo_unavailable', MESSAGES.unavailable)
    }

    chargeAddress(addressOf(req), now())

    const outcome = await runOnce(provider, command)
    const cost = costCents(outcome.elapsedMs)

    options.store.usage.push({
      id: nextId('usage_'),
      tenantId: options.tenantId,
      ref: outcome.id,
      product: 'sandbox',
      cents: cost,
      currency: 'USD',
      createdAt: now(),
    })

    return new Response(
      JSON.stringify({
        stdout: outcome.result.stdout,
        stderr: outcome.result.stderr,
        exit_code: outcome.result.exitCode,
        cost_cents: cost,
        sandbox_id: outcome.id,
      }),
      { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } },
    )
  }

  return {
    async handle(req: Request): Promise<Response> {
      const requestId = nextId('req_')
      let response: Response
      try {
        response = await runRequest(req)
      } catch (err) {
        // The provider's own message may name a vendor resource; a public page
        // gets one fixed sentence and the request id to quote to support.
        const refusal =
          err instanceof DemoRefusal
            ? err
            : new DemoRefusal(502, 'provider_error', 'provider_error', MESSAGES.failed)
        response = errorJson(refusal, requestId)
      }
      response.headers.set('x-request-id', requestId)
      return response
    },
  }
}

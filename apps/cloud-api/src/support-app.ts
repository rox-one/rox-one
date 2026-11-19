/**
 * HTTP surface of the support layer for Rox Cloud (BYOK).
 *
 * Two fronts live here, both fed by the tested cores in
 * `packages/cloud-support`:
 * - customer routes: `/v1/tickets…` under the tenant's own API key, plus the
 *   public `/status` view that needs no key at all;
 * - staff routes: `/admin/tickets…`, `/admin/incidents…` and `/admin/abuse…`
 *   under the shared staff key, the same one `admin.ts` accepts.
 *
 * Three rules hold:
 * - the tenant is read from the presented key and never from a body, and
 *   another tenant's ticket answers exactly like an unknown id — 404;
 * - `/status` shows title, public summary, severity and status only: scopes,
 *   ids, timelines and tenant data never reach it;
 * - every staff write leaves an audit row when a trail is wired, and every
 *   failure uses the `{error:{type, code, message, request_id}}` envelope.
 */

import { createHash, timingSafeEqual } from 'node:crypto'

import type {
  AbuseDecision,
  AbuseFlag,
  AbuseQueue,
  Incident,
  IncidentScope,
  IncidentSeverity,
  IncidentStatus,
  IncidentStore,
  MessageBody,
  PublicIncident,
  SupportErrorCode,
  Ticket,
  TicketMessage,
  TicketPriority,
  TicketStatus,
  TicketStore,
} from '../../../packages/cloud-support/src/index.ts'
import { SupportError } from '../../../packages/cloud-support/src/index.ts'
import { verifyApiKey } from './auth.ts'
import { nextId } from './store.ts'
import type { MemoryStore } from './store.ts'

// ============================================================
// Audit trail
// ============================================================

/** One row this layer is allowed to write. Never carries a secret. */
export interface SupportAuditEntryInput {
  readonly actorId: string
  readonly action: string
  readonly targetType: string
  readonly targetId: string
  readonly reason: string
  readonly details?: Record<string, unknown>
}

/**
 * The slice of the audit trail the support layer writes through.
 *
 * `AuditLog` in `cloud-ops` types `action` as the closed union of control-plane
 * moves; a support action is a different vocabulary with the same row shape.
 * Stating the shape here keeps a real `AuditLog` (its hash chain and its secret
 * scan included) as the only writer, without widening a type that belongs to
 * another package.
 */
export interface SupportAudit {
  append(input: SupportAuditEntryInput): unknown
}

// ============================================================
// Errors
// ============================================================

type RouteErrorCode = SupportErrorCode | 'authentication_required' | 'internal_error'

const STATUS_BY_CODE: Record<RouteErrorCode, number> = {
  invalid_input: 400,
  secret_in_ticket: 400,
  secret_in_record: 400,
  authentication_required: 401,
  not_found: 404,
  invalid_state: 409,
  internal_error: 500,
}

const TYPE_BY_CODE: Record<RouteErrorCode, string> = {
  invalid_input: 'invalid_request_error',
  secret_in_ticket: 'invalid_request_error',
  secret_in_record: 'invalid_request_error',
  authentication_required: 'authentication_error',
  not_found: 'not_found_error',
  invalid_state: 'conflict_error',
  internal_error: 'api_error',
}

/** Same envelope as the public API, so one reader parses every failure. */
class RouteError extends Error {
  readonly code: RouteErrorCode
  readonly status: number
  readonly type: string

  constructor(code: RouteErrorCode, message: string) {
    super(message)
    this.name = 'RouteError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
    this.type = TYPE_BY_CODE[code]
  }
}

function toRouteError(err: unknown): RouteError {
  if (err instanceof RouteError) return err
  if (err instanceof SupportError) return new RouteError(err.code, err.message)
  // The cores reject with `SupportError` only, so anything else is our bug: it
  // is reported as an internal failure rather than blamed on the request.
  const detail = err instanceof Error ? err.message : String(err)
  return new RouteError('internal_error', `Непредвиденная ошибка: ${detail}`)
}

// ============================================================
// Small helpers
// ============================================================

const PRIORITIES: readonly TicketPriority[] = ['low', 'normal', 'high']
const TICKET_STATUSES: readonly TicketStatus[] = ['open', 'pending', 'resolved']
const SEVERITIES: readonly IncidentSeverity[] = ['minor', 'major', 'critical']
const INCIDENT_STATUSES: readonly IncidentStatus[] = [
  'investigating',
  'identified',
  'monitoring',
  'resolved',
]
const DECISIONS: readonly AbuseDecision[] = ['none', 'warn', 'throttle', 'stop']

/** Recorded as the actor when a staff request names no staff member. */
const STAFF_ACTOR = 'staff'

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function finish(response: Response, requestId: string): Response {
  response.headers.set('x-request-id', requestId)
  return response
}

/** Same-length comparison: both sides are hashed first, so timing leaks nothing. */
function sameSecret(presented: string, expected: string): boolean {
  const left = createHash('sha256').update(presented, 'utf8').digest()
  const right = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(left, right)
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text()
  if (text.trim().length === 0) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new RouteError('invalid_input', 'Тело запроса не является корректным JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RouteError('invalid_input', 'Тело запроса должно быть объектом JSON')
  }
  return parsed as Record<string, unknown>
}

function requiredText(body: Record<string, unknown>, key: string, field = key): string {
  const value = body[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RouteError('invalid_input', `Поле ${field} обязательно и должно быть непустой строкой`)
  }
  return value
}

/** A message is plain text or a structured object; the core does the rest. */
function parseMessage(value: unknown): MessageBody {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  throw new RouteError('invalid_input', 'Поле body обязательно: текст сообщения или объект')
}

function parsePriority(value: unknown): TicketPriority | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !(PRIORITIES as readonly string[]).includes(value)) {
    throw new RouteError('invalid_input', `Поле priority должно быть одним из: ${PRIORITIES.join(', ')}`)
  }
  return value as TicketPriority
}

function parseTicketStatus(value: string | null): TicketStatus | undefined {
  if (value === null || value === '') return undefined
  if (!(TICKET_STATUSES as readonly string[]).includes(value)) {
    throw new RouteError(
      'invalid_input',
      `Параметр status должен быть одним из: ${TICKET_STATUSES.join(', ')}`,
    )
  }
  return value as TicketStatus
}

function parseDecision(value: string | null): AbuseDecision | undefined {
  if (value === null || value === '') return undefined
  if (!(DECISIONS as readonly string[]).includes(value)) {
    throw new RouteError('invalid_input', `Параметр decision должен быть одним из: ${DECISIONS.join(', ')}`)
  }
  return value as AbuseDecision
}

function parseSeverity(value: unknown): IncidentSeverity {
  if (typeof value !== 'string' || !(SEVERITIES as readonly string[]).includes(value)) {
    throw new RouteError(
      'invalid_input',
      `Поле severity обязательно и должно быть одним из: ${SEVERITIES.join(', ')}`,
    )
  }
  return value as IncidentSeverity
}

function parseIncidentStatus(value: unknown): IncidentStatus {
  if (typeof value !== 'string' || !(INCIDENT_STATUSES as readonly string[]).includes(value)) {
    throw new RouteError(
      'invalid_input',
      `Поле status обязательно и должно быть одним из: ${INCIDENT_STATUSES.join(', ')}`,
    )
  }
  return value as IncidentStatus
}

/**
 * Scope entries are handed to the incident core as they are: it checks every
 * field name and value itself, and it is the only writer of an incident.
 */
function parseScopes(value: unknown): IncidentScope[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new RouteError('invalid_input', 'Поле scopes должно быть списком объектов')
  }
  return value.map((entry: unknown, index: number) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new RouteError(
        'invalid_input',
        `Область инцидента ${index} должна быть объектом {provider?, region?, product?}`,
      )
    }
    return entry as IncidentScope
  })
}

// ============================================================
// Projections
// ============================================================

function messageJson(message: TicketMessage, withAuthor: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: message.id,
    object: 'ticket_message',
    author_role: message.authorRole,
    body: message.body,
    created_at: message.createdAt,
  }
  // A staff id is staff business: the customer sees who spoke, not who it was.
  if (withAuthor) out.author_id = message.authorId
  return out
}

/** What the tenant that owns the ticket may see. */
function customerTicketJson(ticket: Ticket): Record<string, unknown> {
  return {
    id: ticket.id,
    object: 'ticket',
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    created_at: ticket.createdAt,
    updated_at: ticket.updatedAt,
    messages: ticket.messages.map((message) => messageJson(message, false)),
  }
}

/** Same thread plus the tenant id, for the staff panel. */
function staffTicketJson(ticket: Ticket): Record<string, unknown> {
  return {
    ...customerTicketJson(ticket),
    tenant_id: ticket.tenantId,
    messages: ticket.messages.map((message) => messageJson(message, true)),
  }
}

function incidentJson(incident: Incident): Record<string, unknown> {
  return {
    id: incident.id,
    object: 'incident',
    title: incident.title,
    public_summary: incident.publicSummary,
    severity: incident.severity,
    status: incident.status,
    scopes: incident.scopes.map((scope) => ({ ...scope })),
    created_at: incident.createdAt,
    updated_at: incident.updatedAt,
    timeline: incident.timeline.map((entry) => ({
      id: entry.id,
      object: 'incident_update',
      status: entry.status,
      note: entry.note,
      at: entry.at,
    })),
  }
}

/** The whole public view of one incident: five fields and nothing else. */
function publicIncidentJson(incident: PublicIncident): Record<string, unknown> {
  return {
    title: incident.title,
    public_summary: incident.publicSummary,
    severity: incident.severity,
    status: incident.status,
    updated_at: incident.updatedAt,
  }
}

function abuseJson(flag: AbuseFlag): Record<string, unknown> {
  const evidence = flag.evidence
  return {
    id: flag.id,
    object: 'abuse_flag',
    tenant_id: flag.tenantId,
    sandbox_id: flag.sandboxId,
    at: flag.at,
    decision: flag.decision,
    reason: flag.reason,
    evidence: {
      cpu_pct: evidence.cpuPct,
      egress_bytes_per_min: evidence.egressBytesPerMin,
      outbound_connections: evidence.outboundConnections,
      previous_cpu_pct: evidence.previousCpuPct ?? null,
      thresholds: {
        cpu_pct: evidence.thresholds.cpuPct,
        egress_bytes_per_min: evidence.thresholds.egressBytesPerMin,
        outbound_connections: evidence.thresholds.outboundConnections,
      },
    },
    state: flag.state,
    dismissed_reason: flag.dismissedReason ?? null,
    confirmed_by: flag.confirmedBy ?? null,
    decided_at: flag.decidedAt ?? null,
  }
}

// ============================================================
// Route handlers
// ============================================================

/** One mountable front: a request in, a response or a `RouteError` out. */
export interface SupportRoutes {
  handle(req: Request): Promise<Response>
}

export interface CustomerRoutesOptions {
  /** Control-plane state: API keys are verified against it. */
  readonly store: MemoryStore
  readonly tickets: TicketStore
  readonly incidents: IncidentStore
  /** Clock for key stamping; injected so tests do not touch the wall clock. */
  readonly now?: () => number
}

export interface AdminRoutesOptions {
  readonly tickets: TicketStore
  readonly incidents: IncidentStore
  readonly abuse: AbuseQueue
  /** Append-only staff trail; absent means no audit row is written. */
  readonly audit?: SupportAudit
  /** Shared staff key; absent means every staff route answers 404. */
  readonly adminKey?: string
}

export function createCustomerRoutes(options: CustomerRoutesOptions): SupportRoutes {
  const { store, tickets, incidents } = options
  const now = options.now ?? (() => Date.now())

  function requireTenant(req: Request): string {
    const header = (req.headers.get('authorization') ?? '').trim()
    const match = /^bearer\s+(.+)$/i.exec(header)
    if (!match) {
      throw new RouteError(
        'authentication_required',
        'Нужен ключ API: заголовок Authorization: Bearer rox_sk_live_…',
      )
    }
    const verified = verifyApiKey(store, match[1].trim(), now())
    if (!verified) {
      throw new RouteError('authentication_required', 'Ключ API неизвестен или отозван')
    }
    return verified.tenant.id
  }

  /** One ticket of this tenant; anyone else's id answers like an unknown one. */
  function ticketFor(tenantId: string, id: string): Ticket {
    const ticket = tickets.get(id)
    if (!ticket || ticket.tenantId !== tenantId) throw new RouteError('not_found', 'Запрос не найден')
    return ticket
  }

  function createTicketRoute(tenantId: string, body: Record<string, unknown>): Response {
    const ticket = tickets.open({
      tenantId,
      subject: requiredText(body, 'subject'),
      body: parseMessage(body.body),
      priority: parsePriority(body.priority),
    })
    return json(201, customerTicketJson(ticket))
  }

  function listTicketsRoute(tenantId: string): Response {
    const data = tickets.list({ tenantId }).map(customerTicketJson)
    return json(200, { object: 'list', data })
  }

  function replyRoute(tenantId: string, id: string, body: Record<string, unknown>): Response {
    const ticket = ticketFor(tenantId, id)
    const updated = tickets.reply(ticket.id, {
      authorRole: 'customer',
      authorId: tenantId,
      body: parseMessage(body.body),
    })
    return json(200, customerTicketJson(updated))
  }

  /**
   * The public status view. Only live incidents are shown — a resolved one
   * leaves the page — and `publicView()` is the only source, so no scope, id,
   * timeline or tenant data can reach it.
   */
  function statusRoute(): Response {
    const data = incidents
      .publicView()
      .filter((entry) => entry.status !== 'resolved')
      .map(publicIncidentJson)
    return json(200, { incidents: data })
  }

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const segments = url.pathname.split('/').filter((part) => part.length > 0)
    const method = req.method.toUpperCase()

    if (segments.length === 1 && segments[0] === 'status' && method === 'GET') return statusRoute()

    if (segments[0] !== 'v1' || segments[1] !== 'tickets') {
      throw new RouteError('not_found', 'Такого адреса нет')
    }

    const tenantId = requireTenant(req)
    if (segments.length === 2 && method === 'POST') {
      return createTicketRoute(tenantId, await readJson(req))
    }
    if (segments.length === 2 && method === 'GET') return listTicketsRoute(tenantId)
    if (segments.length === 3 && method === 'GET') {
      return json(200, customerTicketJson(ticketFor(tenantId, segments[2])))
    }
    if (segments.length === 4 && segments[3] === 'reply' && method === 'POST') {
      return replyRoute(tenantId, segments[2], await readJson(req))
    }
    throw new RouteError('not_found', 'Такого адреса нет')
  }

  return {
    async handle(req: Request): Promise<Response> {
      const requestId = nextId('req_')
      let response: Response
      try {
        response = await route(req)
      } catch (err) {
        const routeError = toRouteError(err)
        response = json(routeError.status, {
          error: {
            type: routeError.type,
            code: routeError.code,
            message: routeError.message,
            request_id: requestId,
          },
        })
      }
      return finish(response, requestId)
    },
  }
}

export function createAdminRoutes(options: AdminRoutesOptions): SupportRoutes {
  const { tickets, incidents, abuse, audit, adminKey } = options

  function requireStaff(req: Request): void {
    const header = (req.headers.get('authorization') ?? '').trim()
    const match = /^bearer\s+(.+)$/i.exec(header)
    if (!match || adminKey === undefined) {
      throw new RouteError(
        'authentication_required',
        'Нужен ключ дежурного: заголовок Authorization: Bearer …',
      )
    }
    if (!sameSecret(match[1].trim(), adminKey)) {
      throw new RouteError('authentication_required', 'Ключ дежурного не совпадает')
    }
  }

  function appendAudit(entry: SupportAuditEntryInput): void {
    if (audit === undefined) return
    audit.append(entry)
  }

  // ---------- tickets ----------

  function listTicketsRoute(url: URL): Response {
    const status = parseTicketStatus(url.searchParams.get('status'))
    const data = tickets.list(status === undefined ? {} : { status }).map(staffTicketJson)
    return json(200, { object: 'list', data })
  }

  async function replyTicketRoute(id: string, req: Request): Promise<Response> {
    const body = await readJson(req)
    const authorId = requiredText(body, 'authorId')
    const before = tickets.get(id)
    const ticket = tickets.reply(id, {
      authorRole: 'staff',
      authorId,
      body: parseMessage(body.body),
    })
    appendAudit({
      actorId: authorId,
      action: 'ticket.reply',
      targetType: 'ticket',
      targetId: ticket.id,
      reason: `Ответ дежурного в запросе ${ticket.id}`,
      details: { tenant_id: ticket.tenantId, from_status: before?.status ?? null, to_status: ticket.status },
    })
    return json(200, staffTicketJson(ticket))
  }

  async function resolveTicketRoute(id: string, req: Request): Promise<Response> {
    const body = await readJson(req)
    const authorId = requiredText(body, 'authorId')
    const before = tickets.get(id)
    const ticket = tickets.resolve(id, authorId)
    appendAudit({
      actorId: authorId,
      action: 'ticket.resolve',
      targetType: 'ticket',
      targetId: ticket.id,
      reason: `Запрос ${ticket.id} закрыт дежурным`,
      details: { tenant_id: ticket.tenantId, from_status: before?.status ?? null, to_status: ticket.status },
    })
    return json(200, staffTicketJson(ticket))
  }

  // ---------- incidents ----------

  function listIncidentsRoute(): Response {
    return json(200, { object: 'list', data: incidents.list().map(incidentJson) })
  }

  async function openIncidentRoute(req: Request): Promise<Response> {
    const body = await readJson(req)
    const incident = incidents.open({
      title: requiredText(body, 'title'),
      publicSummary: requiredText(body, 'publicSummary'),
      severity: parseSeverity(body.severity),
      scopes: parseScopes(body.scopes),
    })
    appendAudit({
      actorId: STAFF_ACTOR,
      action: 'incident.open',
      targetType: 'incident',
      targetId: incident.id,
      reason: `Инцидент открыт: ${incident.title}`,
      details: { severity: incident.severity, status: incident.status },
    })
    return json(201, incidentJson(incident))
  }

  async function updateIncidentRoute(id: string, req: Request): Promise<Response> {
    const body = await readJson(req)
    const note = requiredText(body, 'note')
    const before = incidents.list().find((entry) => entry.id === id)
    const incident = incidents.update(id, { status: parseIncidentStatus(body.status), note })
    appendAudit({
      actorId: STAFF_ACTOR,
      action: 'incident.update',
      targetType: 'incident',
      targetId: incident.id,
      reason: `Статус инцидента: ${incident.status}. ${note}`,
      details: { from_status: before?.status ?? null, to_status: incident.status },
    })
    return json(200, incidentJson(incident))
  }

  async function resolveIncidentRoute(id: string, req: Request): Promise<Response> {
    const body = await readJson(req)
    const note = requiredText(body, 'note')
    const before = incidents.list().find((entry) => entry.id === id)
    const incident = incidents.resolve(id, note)
    appendAudit({
      actorId: STAFF_ACTOR,
      action: 'incident.resolve',
      targetType: 'incident',
      targetId: incident.id,
      reason: note,
      details: { from_status: before?.status ?? null, to_status: incident.status },
    })
    return json(200, incidentJson(incident))
  }

  // ---------- abuse ----------

  function listAbuseRoute(url: URL): Response {
    const decision = parseDecision(url.searchParams.get('decision'))
    const data = abuse.list(decision === undefined ? {} : { decision }).map(abuseJson)
    return json(200, { object: 'list', data })
  }

  async function confirmAbuseRoute(id: string, req: Request): Promise<Response> {
    const body = await readJson(req)
    const staffId = requiredText(body, 'staffId')
    const flag = abuse.confirm(id, staffId)
    appendAudit({
      actorId: staffId,
      action: 'abuse.confirm',
      targetType: 'abuse_flag',
      targetId: flag.id,
      reason: `Нарушение подтверждено: ${flag.reason}`,
      details: { tenant_id: flag.tenantId, sandbox_id: flag.sandboxId, decision: flag.decision },
    })
    return json(200, abuseJson(flag))
  }

  async function dismissAbuseRoute(id: string, req: Request): Promise<Response> {
    const body = await readJson(req)
    const reason = requiredText(body, 'reason')
    const flag = abuse.dismiss(id, reason)
    appendAudit({
      actorId: STAFF_ACTOR,
      action: 'abuse.dismiss',
      targetType: 'abuse_flag',
      targetId: flag.id,
      reason,
      details: { tenant_id: flag.tenantId, sandbox_id: flag.sandboxId, decision: flag.decision },
    })
    return json(200, abuseJson(flag))
  }

  // ---------- routing ----------

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const segments = url.pathname.split('/').filter((part) => part.length > 0)
    const method = req.method.toUpperCase()

    if (segments[0] !== 'admin') throw new RouteError('not_found', 'Такого адреса нет')
    requireStaff(req)

    const section = segments[1]
    const id = segments[2]

    if (section === 'tickets') {
      if (segments.length === 2 && method === 'GET') return listTicketsRoute(url)
      if (segments.length === 4 && method === 'POST' && segments[3] === 'reply') {
        return replyTicketRoute(id, req)
      }
      if (segments.length === 4 && method === 'POST' && segments[3] === 'resolve') {
        return resolveTicketRoute(id, req)
      }
    }

    if (section === 'incidents') {
      if (segments.length === 2 && method === 'GET') return listIncidentsRoute()
      if (segments.length === 2 && method === 'POST') return openIncidentRoute(req)
      if (segments.length === 4 && method === 'POST' && segments[3] === 'update') {
        return updateIncidentRoute(id, req)
      }
      if (segments.length === 4 && method === 'POST' && segments[3] === 'resolve') {
        return resolveIncidentRoute(id, req)
      }
    }

    if (section === 'abuse') {
      if (segments.length === 2 && method === 'GET') return listAbuseRoute(url)
      if (segments.length === 4 && method === 'POST' && segments[3] === 'confirm') {
        return confirmAbuseRoute(id, req)
      }
      if (segments.length === 4 && method === 'POST' && segments[3] === 'dismiss') {
        return dismissAbuseRoute(id, req)
      }
    }

    throw new RouteError('not_found', 'Такого адреса нет')
  }

  return {
    async handle(req: Request): Promise<Response> {
      const requestId = nextId('req_')
      if (adminKey === undefined) {
        // Not configured: no hint that a key would help, and no default key.
        return finish(
          json(404, {
            error: {
              type: 'not_found_error',
              code: 'not_found',
              message: 'Панель дежурного не настроена: задайте ROX_ADMIN_KEY',
              request_id: requestId,
            },
          }),
          requestId,
        )
      }
      let response: Response
      try {
        response = await route(req)
      } catch (err) {
        const routeError = toRouteError(err)
        response = json(routeError.status, {
          error: {
            type: routeError.type,
            code: routeError.code,
            message: routeError.message,
            request_id: requestId,
          },
        })
      }
      return finish(response, requestId)
    },
  }
}

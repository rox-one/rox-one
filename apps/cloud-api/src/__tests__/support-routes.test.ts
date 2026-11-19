/**
 * Contract tests for the support front of Rox Cloud.
 *
 * Customer tickets, the public status page and the staff queue (tickets,
 * incidents, abuse flags) are driven through `Request`/`Response`, exactly as
 * the console, the panel and the SDK do. Every tenant key is minted here, so no
 * real credential is involved.
 */

import { describe, expect, test } from 'bun:test'

import { createAuditLog } from '../../../../packages/cloud-ops/src/index.ts'
import type { AuditLog } from '../../../../packages/cloud-ops/src/index.ts'
import { createHandler } from '../server.ts'
import { generateApiKey } from '../auth.ts'
import { createMemoryStore, nextId } from '../store.ts'
import type { MemoryStore, Scope, Tenant } from '../store.ts'
import { createSupport } from '../support.ts'
import type { SupportApp } from '../support.ts'

// ============================================================
// Fixtures
// ============================================================

const NOW = Date.UTC(2026, 10, 19, 12, 0, 0)
const ADMIN_KEY = 'dezhurnyj-klyuch'

const ALL_SCOPES: readonly Scope[] = [
  'sandboxes:read',
  'sandboxes:write',
  'keys:write',
  'billing:read',
]

const THRESHOLDS = { cpuPct: 90, egressBytesPerMin: 1_000_000, outboundConnections: 100 }

interface SeededTenant {
  readonly tenant: Tenant
  readonly secret: string
}

function seedTenant(store: MemoryStore, name: string): SeededTenant {
  const tenant = store.addTenant(name)
  const generated = generateApiKey()
  store.addApiKey({
    id: nextId('key_'),
    tenantId: tenant.id,
    prefix: generated.prefix,
    last4: generated.last4,
    hash: generated.hash,
    scopes: ALL_SCOPES,
    createdAt: NOW,
  })
  return { tenant, secret: generated.secret }
}

interface Harness {
  readonly support: SupportApp
  readonly audit: AuditLog
  readonly first: SeededTenant
  readonly second: SeededTenant
}

/** `adminKey: null` builds a deployment whose staff panel is not configured. */
function harness(options: { adminKey?: string | null } = {}): Harness {
  const store = createMemoryStore()
  const audit = createAuditLog({ now: () => new Date(NOW) })
  const first = seedTenant(store, 'Первая команда')
  const second = seedTenant(store, 'Вторая команда')
  const adminKey = options.adminKey === null ? undefined : (options.adminKey ?? ADMIN_KEY)
  const support = createSupport({
    store,
    audit,
    now: () => NOW,
    ...(adminKey === undefined ? {} : { adminKey }),
  })
  return { support, audit, first, second }
}

// ============================================================
// Calls
// ============================================================

interface CallOptions {
  readonly method?: string
  readonly token?: string
  readonly body?: unknown
}

async function call(
  routes: SupportApp['customerRoutes'],
  path: string,
  options: CallOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = {}
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`
  let body: BodyInit | undefined
  if (options.body !== undefined) {
    body = JSON.stringify(options.body)
    headers['content-type'] = 'application/json'
  }
  return routes.handle(
    new Request(`http://api.test${path}`, { method: options.method ?? 'GET', headers, body }),
  )
}

async function bodyOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

interface TicketBody {
  readonly id: string
  readonly object: string
  readonly subject: string
  readonly status: string
  readonly priority: string
  readonly created_at: string
  readonly updated_at: string
  readonly tenant_id?: string
  readonly messages: readonly {
    readonly id: string
    readonly author_role: string
    readonly body: string
    readonly author_id?: string
    readonly created_at: string
  }[]
}

interface ListBody<T> {
  readonly object: string
  readonly data: readonly T[]
}

interface IncidentBody {
  readonly id: string
  readonly object: string
  readonly title: string
  readonly public_summary: string
  readonly severity: string
  readonly status: string
  readonly scopes: readonly Record<string, string>[]
  readonly timeline: readonly { readonly status: string; readonly note: string }[]
}

interface StatusBody {
  readonly incidents: readonly {
    readonly title: string
    readonly public_summary: string
    readonly severity: string
    readonly status: string
    readonly updated_at: string
  }[]
}

interface AbuseBody {
  readonly id: string
  readonly object: string
  readonly tenant_id: string
  readonly sandbox_id: string
  readonly decision: string
  readonly reason: string
  readonly state: string
  readonly dismissed_reason: string | null
  readonly confirmed_by: string | null
}

interface ErrorBody {
  readonly error: {
    readonly type: string
    readonly code: string
    readonly message: string
    readonly request_id: string
  }
}

/** Opens a ticket for the first tenant and returns it. */
async function openTicket(support: SupportApp, secret: string): Promise<TicketBody> {
  const response = await call(support.customerRoutes, '/v1/tickets', {
    method: 'POST',
    token: secret,
    body: { subject: 'Машина висит в starting', body: 'Полчаса в состоянии starting, порт не отвечает' },
  })
  expect(response.status).toBe(201)
  return bodyOf<TicketBody>(response)
}

// ============================================================
// Customer tickets
// ============================================================

describe('customer tickets', () => {
  test('create, list and reply stay on one thread', async () => {
    const h = harness()
    const ticket = await openTicket(h.support, h.first.secret)

    expect(ticket.object).toBe('ticket')
    expect(ticket.status).toBe('open')
    expect(ticket.priority).toBe('normal')
    expect(ticket.messages).toHaveLength(1)
    expect(ticket.messages[0]!.author_role).toBe('customer')
    expect(ticket.messages[0]!.body).toContain('starting')
    // The tenant id is staff business: the customer view does not repeat it.
    expect(ticket.tenant_id).toBeUndefined()

    const list = await bodyOf<ListBody<TicketBody>>(
      await call(h.support.customerRoutes, '/v1/tickets', { token: h.first.secret }),
    )
    expect(list.object).toBe('list')
    expect(list.data.map((entry) => entry.id)).toEqual([ticket.id])

    const replied = await bodyOf<TicketBody>(
      await call(h.support.customerRoutes, `/v1/tickets/${ticket.id}/reply`, {
        method: 'POST',
        token: h.first.secret,
        body: { body: 'Добавляю: перезапуск не помог' },
      }),
    )
    expect(replied.messages).toHaveLength(2)
    // A customer writing puts the ball back with staff.
    expect(replied.status).toBe('open')

    const single = await call(h.support.customerRoutes, `/v1/tickets/${ticket.id}`, {
      token: h.first.secret,
    })
    expect(single.status).toBe(200)
    expect((await bodyOf<TicketBody>(single)).id).toBe(ticket.id)
  })

  test('a second tenant cannot read the ticket and sees an empty list', async () => {
    const h = harness()
    const ticket = await openTicket(h.support, h.first.secret)

    const foreign = await call(h.support.customerRoutes, `/v1/tickets/${ticket.id}`, {
      token: h.second.secret,
    })
    expect(foreign.status).toBe(404)
    const failure = await bodyOf<ErrorBody>(foreign)
    expect(failure.error.code).toBe('not_found')
    expect(failure.error.request_id).toMatch(/^req_[0-9a-f]{24}$/)

    const listOfSecond = await bodyOf<ListBody<TicketBody>>(
      await call(h.support.customerRoutes, '/v1/tickets', { token: h.second.secret }),
    )
    expect(listOfSecond.data).toHaveLength(0)
  })

  test('a ticket without a key answers 401 with the envelope', async () => {
    const h = harness()
    const response = await call(h.support.customerRoutes, '/v1/tickets')
    expect(response.status).toBe(401)
    const failure = await bodyOf<ErrorBody>(response)
    expect(failure.error.type).toBe('authentication_error')
    expect(failure.error.code).toBe('authentication_required')
    expect(failure.error.request_id).toMatch(/^req_[0-9a-f]{24}$/)
    expect(response.headers.get('x-request-id')).toBe(failure.error.request_id)
  })

  test('a provider key in the text is refused before it is stored', async () => {
    const h = harness()
    const response = await call(h.support.customerRoutes, '/v1/tickets', {
      method: 'POST',
      token: h.first.secret,
      body: { subject: 'Ключ не работает', body: 'Мой ключ: sk-live-abcdef' },
    })
    expect(response.status).toBe(400)
    const failure = await bodyOf<ErrorBody>(response)
    expect(failure.error.code).toBe('secret_in_ticket')
    expect(h.support.tickets.tickets).toHaveLength(0)
  })
})

// ============================================================
// Staff tickets
// ============================================================

describe('staff tickets', () => {
  test('a staff reply moves the ticket to pending and leaves an audit row', async () => {
    const h = harness()
    const ticket = await openTicket(h.support, h.first.secret)

    const replied = await bodyOf<TicketBody>(
      await call(h.support.adminRoutes, `/admin/tickets/${ticket.id}/reply`, {
        method: 'POST',
        token: ADMIN_KEY,
        body: { body: 'Провайдер снова доступен, попробуйте запустить', authorId: 'anna' },
      }),
    )
    expect(replied.status).toBe('pending')
    expect(replied.messages).toHaveLength(2)
    expect(replied.messages[1]!.author_role).toBe('staff')
    expect(replied.messages[1]!.author_id).toBe('anna')
    expect(replied.tenant_id).toBe(h.first.tenant.id)

    const trail = h.audit.list()
    expect(trail).toHaveLength(1)
    expect(trail[0]!.action).toBe('ticket.reply')
    expect(trail[0]!.actorId).toBe('anna')
    expect(trail[0]!.targetId).toBe(ticket.id)
    expect(h.audit.verifyChain().ok).toBe(true)
  })

  test('resolve closes the ticket and a customer reply then answers 409', async () => {
    const h = harness()
    const ticket = await openTicket(h.support, h.first.secret)

    const resolved = await bodyOf<TicketBody>(
      await call(h.support.adminRoutes, `/admin/tickets/${ticket.id}/resolve`, {
        method: 'POST',
        token: ADMIN_KEY,
        body: { authorId: 'anna' },
      }),
    )
    expect(resolved.status).toBe('resolved')

    const late = await call(h.support.customerRoutes, `/v1/tickets/${ticket.id}/reply`, {
      method: 'POST',
      token: h.first.secret,
      body: { body: 'Ещё вопрос' },
    })
    expect(late.status).toBe(409)
    const failure = await bodyOf<ErrorBody>(late)
    expect(failure.error.code).toBe('invalid_state')
    expect(failure.error.request_id).toMatch(/^req_[0-9a-f]{24}$/)
  })

  test('the list filters by status', async () => {
    const h = harness()
    const ticket = await openTicket(h.support, h.first.secret)
    await call(h.support.adminRoutes, `/admin/tickets/${ticket.id}/reply`, {
      method: 'POST',
      token: ADMIN_KEY,
      body: { body: 'Смотрим', authorId: 'anna' },
    })

    const pending = await bodyOf<ListBody<TicketBody>>(
      await call(h.support.adminRoutes, '/admin/tickets?status=pending', { token: ADMIN_KEY }),
    )
    expect(pending.data.map((entry) => entry.id)).toEqual([ticket.id])

    const open = await bodyOf<ListBody<TicketBody>>(
      await call(h.support.adminRoutes, '/admin/tickets?status=open', { token: ADMIN_KEY }),
    )
    expect(open.data).toHaveLength(0)

    const bogus = await call(h.support.adminRoutes, '/admin/tickets?status=closed', {
      token: ADMIN_KEY,
    })
    expect(bogus.status).toBe(400)
    expect((await bodyOf<ErrorBody>(bogus)).error.code).toBe('invalid_input')
  })
})

// ============================================================
// Public status page
// ============================================================

describe('public status page', () => {
  test('shows five fields and no tenant or incident identity', async () => {
    const h = harness()
    await call(h.support.adminRoutes, '/admin/incidents', {
      method: 'POST',
      token: ADMIN_KEY,
      body: {
        title: 'Деградация запусков в одном регионе',
        publicSummary: 'Запуск машин идёт медленнее обычного.',
        severity: 'major',
        scopes: [{ region: 'eu-central' }],
      },
    })

    const response = await call(h.support.customerRoutes, '/status')
    expect(response.status).toBe(200)
    const text = await response.text()
    const page = JSON.parse(text) as StatusBody
    expect(page.incidents).toHaveLength(1)
    expect(Object.keys(page.incidents[0]!).sort()).toEqual([
      'public_summary',
      'severity',
      'status',
      'title',
      'updated_at',
    ])
    expect(page.incidents[0]!.status).toBe('investigating')
    // Neither the tenant nor the incident id, its scope or its timeline leaks.
    expect(text).not.toContain(h.first.tenant.id)
    expect(text).not.toContain('inc_')
    expect(text).not.toContain('eu-central')
  })

  test('an incident appears, moves forward and disappears once resolved', async () => {
    const h = harness()
    const created = await bodyOf<IncidentBody>(
      await call(h.support.adminRoutes, '/admin/incidents', {
        method: 'POST',
        token: ADMIN_KEY,
        body: {
          title: 'Сбои исполнения команд',
          publicSummary: 'Часть команд завершается ошибкой.',
          severity: 'critical',
          scopes: [],
        },
      }),
    )
    expect(created.status).toBe('investigating')
    expect(created.scopes).toEqual([])

    const openPage = await bodyOf<StatusBody>(await call(h.support.customerRoutes, '/status'))
    expect(openPage.incidents).toHaveLength(1)

    const updated = await bodyOf<IncidentBody>(
      await call(h.support.adminRoutes, `/admin/incidents/${created.id}/update`, {
        method: 'POST',
        token: ADMIN_KEY,
        body: { status: 'identified', note: 'Причина найдена в очереди заданий' },
      }),
    )
    expect(updated.status).toBe('identified')
    expect(updated.timeline.map((entry) => entry.status)).toEqual(['investigating', 'identified'])

    const movedPage = await bodyOf<StatusBody>(await call(h.support.customerRoutes, '/status'))
    expect(movedPage.incidents[0]!.status).toBe('identified')

    const backwards = await call(h.support.adminRoutes, `/admin/incidents/${created.id}/update`, {
      method: 'POST',
      token: ADMIN_KEY,
      body: { status: 'investigating', note: 'Шаг назад' },
    })
    expect(backwards.status).toBe(409)
    expect((await bodyOf<ErrorBody>(backwards)).error.code).toBe('invalid_state')

    const resolved = await bodyOf<IncidentBody>(
      await call(h.support.adminRoutes, `/admin/incidents/${created.id}/resolve`, {
        method: 'POST',
        token: ADMIN_KEY,
        body: { note: 'Очередь заданий обработана, команды проходят' },
      }),
    )
    expect(resolved.status).toBe('resolved')

    const closedPage = await bodyOf<StatusBody>(await call(h.support.customerRoutes, '/status'))
    expect(closedPage.incidents).toHaveLength(0)

    const trail = h.audit.list()
    expect(trail.map((entry) => entry.action)).toEqual([
      'incident.open',
      'incident.update',
      'incident.resolve',
    ])
  })

  test('an incident record refuses a specific key as its scope', async () => {
    const h = harness()
    const response = await call(h.support.adminRoutes, '/admin/incidents', {
      method: 'POST',
      token: ADMIN_KEY,
      body: {
        title: 'Проверка',
        publicSummary: 'Ключ не должен попасть в инцидент: sk-live-abcdef',
        severity: 'minor',
        scopes: [],
      },
    })
    expect(response.status).toBe(400)
    expect((await bodyOf<ErrorBody>(response)).error.code).toBe('secret_in_record')
    expect(h.support.incidents.incidents).toHaveLength(0)
  })
})

// ============================================================
// Abuse queue
// ============================================================

describe('abuse queue', () => {
  test('confirming a flag records the staff member', async () => {
    const h = harness()
    const sample = {
      tenantId: h.first.tenant.id,
      sandboxId: 'sbx_egress',
      at: new Date(NOW).toISOString(),
      cpuPct: 20,
      egressBytesPerMin: 5_000_000,
      outboundConnections: 4,
    }
    const flag = h.support.abuse.record(sample, THRESHOLDS)
    expect(flag.decision).toBe('stop')

    const confirmed = await bodyOf<AbuseBody>(
      await call(h.support.adminRoutes, `/admin/abuse/${flag.id}/confirm`, {
        method: 'POST',
        token: ADMIN_KEY,
        body: { staffId: 'anna' },
      }),
    )
    expect(confirmed.state).toBe('confirmed')
    expect(confirmed.confirmed_by).toBe('anna')
    expect(confirmed.tenant_id).toBe(h.first.tenant.id)
    expect(confirmed.reason).toContain('исходящий трафик')

    const trail = h.audit.list()
    expect(trail.map((entry) => entry.action)).toEqual(['abuse.confirm'])
    expect(trail[0]!.actorId).toBe('anna')

    const again = await call(h.support.adminRoutes, `/admin/abuse/${flag.id}/confirm`, {
      method: 'POST',
      token: ADMIN_KEY,
      body: { staffId: 'anna' },
    })
    expect(again.status).toBe(409)
  })

  test('dismissing keeps the staff reason and the list filters by decision', async () => {
    const h = harness()
    const flag = h.support.abuse.record(
      {
        tenantId: h.second.tenant.id,
        sandboxId: 'sbx_cpu',
        at: new Date(NOW).toISOString(),
        cpuPct: 95,
        egressBytesPerMin: 1_000,
        outboundConnections: 2,
      },
      THRESHOLDS,
    )
    expect(flag.decision).toBe('warn')

    const dismissed = await bodyOf<AbuseBody>(
      await call(h.support.adminRoutes, `/admin/abuse/${flag.id}/dismiss`, {
        method: 'POST',
        token: ADMIN_KEY,
        body: { reason: 'Штатная сборка, пик объяснён' },
      }),
    )
    expect(dismissed.state).toBe('dismissed')
    expect(dismissed.dismissed_reason).toBe('Штатная сборка, пик объяснён')
    expect(dismissed.confirmed_by).toBeNull()

    const warned = await bodyOf<ListBody<AbuseBody>>(
      await call(h.support.adminRoutes, '/admin/abuse?decision=warn', { token: ADMIN_KEY }),
    )
    expect(warned.data.map((entry) => entry.id)).toEqual([flag.id])

    const stopped = await bodyOf<ListBody<AbuseBody>>(
      await call(h.support.adminRoutes, '/admin/abuse?decision=stop', { token: ADMIN_KEY }),
    )
    expect(stopped.data).toHaveLength(0)

    const bogus = await call(h.support.adminRoutes, '/admin/abuse?decision=ban', {
      token: ADMIN_KEY,
    })
    expect(bogus.status).toBe(400)
  })
})

// ============================================================
// Staff boundary
// ============================================================

describe('staff boundary', () => {
  test('an unconfigured panel answers 404 on every staff route', async () => {
    const h = harness({ adminKey: null })
    for (const path of ['/admin/tickets', '/admin/incidents', '/admin/abuse']) {
      const response = await call(h.support.adminRoutes, path)
      expect(response.status).toBe(404)
      const failure = await bodyOf<ErrorBody>(response)
      expect(failure.error.code).toBe('not_found')
      expect(failure.error.request_id).toMatch(/^req_[0-9a-f]{24}$/)
    }
  })

  test('a configured panel refuses a missing or a wrong key', async () => {
    const h = harness()
    const missing = await call(h.support.adminRoutes, '/admin/tickets')
    expect(missing.status).toBe(401)

    const wrong = await call(h.support.adminRoutes, '/admin/tickets', { token: 'ne-tot-klyuch' })
    expect(wrong.status).toBe(401)
    const failure = await bodyOf<ErrorBody>(wrong)
    expect(failure.error.code).toBe('authentication_required')
    expect(failure.error.request_id).toMatch(/^req_[0-9a-f]{24}$/)
  })

  test('an unknown ticket and an unknown incident both answer 404', async () => {
    const h = harness()
    const ticket = await call(h.support.adminRoutes, '/admin/tickets/tkt_missing/reply', {
      method: 'POST',
      token: ADMIN_KEY,
      body: { body: 'Ответ', authorId: 'anna' },
    })
    expect(ticket.status).toBe(404)
    expect((await bodyOf<ErrorBody>(ticket)).error.code).toBe('not_found')

    const incident = await call(h.support.adminRoutes, '/admin/incidents/inc_missing/resolve', {
      method: 'POST',
      token: ADMIN_KEY,
      body: { note: 'Закрываем' },
    })
    expect(incident.status).toBe(404)
  })
})

// ============================================================
// Front door
// ============================================================

describe('front door', () => {
  test('the support paths reach the support app and the rest stays where it was', async () => {
    const h = harness()
    const front = createHandler({
      app: { handle: async () => new Response('app') },
      admin: { handle: async () => new Response('admin') },
      support: h.support,
    })

    const status = await front(new Request('http://api.test/status'))
    expect(status.status).toBe(200)
    expect(await bodyOf<StatusBody>(status)).toEqual({ incidents: [] })

    const tickets = await front(
      new Request('http://api.test/v1/tickets', {
        headers: { authorization: `Bearer ${h.first.secret}` },
      }),
    )
    expect(tickets.status).toBe(200)
    expect((await bodyOf<ListBody<TicketBody>>(tickets)).object).toBe('list')

    const staffList = await front(
      new Request('http://api.test/admin/tickets', {
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
      }),
    )
    expect(staffList.status).toBe(200)
    expect((await bodyOf<ListBody<TicketBody>>(staffList)).object).toBe('list')

    const elsewhere = await front(new Request('http://api.test/v1/sandboxes'))
    expect(await elsewhere.text()).toBe('app')

    const panelElsewhere = await front(new Request('http://api.test/admin/overview'))
    expect(await panelElsewhere.text()).toBe('admin')
  })

  test('without a support app the support paths keep answering 404', async () => {
    const front = createHandler({
      app: { handle: async () => new Response('app', { status: 404 }) },
      admin: { handle: async () => new Response('admin', { status: 404 }) },
    })
    expect((await front(new Request('http://api.test/status'))).status).toBe(404)
    expect((await front(new Request('http://api.test/admin/tickets'))).status).toBe(404)
  })
})

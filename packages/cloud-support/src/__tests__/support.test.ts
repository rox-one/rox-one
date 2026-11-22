import { describe, expect, it } from 'bun:test'
import {
  SupportError,
  createAbuseQueue,
  createIncidentStore,
  createTicketStore,
  evaluateSample,
  type AbuseDecision,
  type AbuseThresholds,
  type IncidentScope,
  type IncidentSeverity,
  type IncidentStore,
  type OpenIncidentInput,
  type OpenTicketInput,
  type TicketStore,
  type UsageSample,
} from '../index.ts'

function tickingClock(start = '2026-11-19T10:00:00.000Z', stepMs = 1_000): () => Date {
  let ms = Date.parse(start)
  return () => new Date((ms += stepMs))
}

function errorCode(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    return error instanceof SupportError ? error.code : undefined
  }
  return undefined
}

function collectLeaves(value: unknown): unknown[] {
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((item) => collectLeaves(item))
  }
  return [value]
}

function openTicket(store: TicketStore, overrides: Partial<OpenTicketInput> = {}) {
  return store.open({
    tenantId: 'tenant_acme',
    subject: 'Сборка падает',
    body: 'Сборка падает на шаге установки зависимостей',
    ...overrides,
  })
}

function openIncident(store: IncidentStore, overrides: Partial<OpenIncidentInput> = {}) {
  return store.open({
    title: 'Задержка запуска песочниц',
    publicSummary: 'Запуск песочниц идёт медленнее обычного',
    severity: 'major',
    scopes: [{ region: 'eu-1', product: 'sandboxes' }],
    ...overrides,
  })
}

const THRESHOLDS: AbuseThresholds = {
  cpuPct: 90,
  egressBytesPerMin: 1_000_000,
  outboundConnections: 500,
}

function sample(overrides: Partial<UsageSample> = {}): UsageSample {
  return {
    tenantId: 'tenant_acme',
    sandboxId: 'sbx_1',
    at: '2026-11-19T10:00:00.000Z',
    cpuPct: 40,
    egressBytesPerMin: 10_000,
    outboundConnections: 20,
    ...overrides,
  }
}

describe('support tickets', () => {
  it('opens a ticket in open status with one customer message', () => {
    const store = createTicketStore({ now: tickingClock() })
    const ticket = openTicket(store)
    expect(ticket.status).toBe('open')
    expect(ticket.priority).toBe('normal')
    expect(ticket.subject).toBe('Сборка падает')
    expect(ticket.createdAt).toBe(ticket.updatedAt)
    expect(ticket.messages).toHaveLength(1)
    expect(ticket.messages[0]!.authorRole).toBe('customer')
    expect(ticket.messages[0]!.authorId).toBe('tenant_acme')
    expect(ticket.messages[0]!.body).toBe('Сборка падает на шаге установки зависимостей')
  })

  it('honours an explicit priority and trims the subject', () => {
    const store = createTicketStore({ now: tickingClock() })
    const ticket = openTicket(store, { subject: '  Оплата не проходит  ', priority: 'high' })
    expect(ticket.subject).toBe('Оплата не проходит')
    expect(ticket.priority).toBe('high')
  })

  it('rejects a subject that is too short or too long', () => {
    const store = createTicketStore({ now: tickingClock() })
    expect(errorCode(() => openTicket(store, { subject: 'ok' }))).toBe('invalid_input')
    expect(errorCode(() => openTicket(store, { subject: 'x'.repeat(121) }))).toBe('invalid_input')
    expect(openTicket(store, { subject: 'x'.repeat(120) }).subject).toHaveLength(120)
  })

  it('rejects an empty message body', () => {
    const store = createTicketStore({ now: tickingClock() })
    expect(errorCode(() => openTicket(store, { body: '   ' }))).toBe('invalid_input')
    expect(errorCode(() => openTicket(store, { body: {} }))).toBe('invalid_input')
    expect(store.tickets).toHaveLength(0)
  })

  it('rejects every key marker pasted as plain text', () => {
    const store = createTicketStore({ now: tickingClock() })
    const bodies = [
      'Мой ключ sk-live-1234567890',
      'Вот ключ rox_sk_abcdef',
      'Заголовок: Bearer abc123',
      '-----BEGIN PRIVATE KEY-----',
    ]
    for (const body of bodies) {
      expect(errorCode(() => openTicket(store, { body }))).toBe('secret_in_ticket')
    }
    const ticket = openTicket(store)
    expect(
      errorCode(() => store.reply(ticket.id, { authorRole: 'customer', authorId: 'tenant_acme', body: 'sk-live-1' })),
    ).toBe('secret_in_ticket')
    expect(store.tickets).toHaveLength(1)
  })

  it('rejects a key pasted into the subject', () => {
    const store = createTicketStore({ now: tickingClock() })
    expect(errorCode(() => openTicket(store, { subject: 'Ключ sk-live-1 не работает' }))).toBe('secret_in_ticket')
  })

  it('does not mistake ordinary words for a key', () => {
    const store = createTicketStore({ now: tickingClock() })
    const ticket = openTicket(store, { body: 'Задача из task-list не запускается, риск небольшой' })
    expect(ticket.messages[0]!.body).toContain('task-list')
  })

  it('rejects a forbidden field name anywhere in an object body', () => {
    const store = createTicketStore({ now: tickingClock() })
    const nested = { provider: { credentials: { token: 'abc' } } }
    expect(errorCode(() => openTicket(store, { body: nested }))).toBe('secret_in_ticket')
    expect(errorCode(() => openTicket(store, { body: { headers: [{ password: 'x' }] } }))).toBe('secret_in_ticket')
    expect(errorCode(() => openTicket(store, { body: { secretKey: 'x', key: 'y' } }))).toBe('secret_in_ticket')
  })

  it('rejects a key marker inside an object body', () => {
    const store = createTicketStore({ now: tickingClock() })
    expect(errorCode(() => openTicket(store, { body: { note: 'sk-live-9' } }))).toBe('secret_in_ticket')
    expect(errorCode(() => openTicket(store, { body: { steps: ['ok', 'Bearer abc'] } }))).toBe('secret_in_ticket')
  })

  it('stores an object body as JSON text', () => {
    const store = createTicketStore({ now: tickingClock() })
    const ticket = openTicket(store, { body: { step: 'install', exitCode: 1 } })
    const body = ticket.messages[0]!.body
    expect(typeof body).toBe('string')
    expect(JSON.parse(body)).toEqual({ step: 'install', exitCode: 1 })
  })

  it('moves the ball between the customer and staff', () => {
    const store = createTicketStore({ now: tickingClock() })
    const ticket = openTicket(store)
    const pending = store.reply(ticket.id, { authorRole: 'staff', authorId: 'staff_anna', body: 'Смотрим' })
    expect(pending.status).toBe('pending')
    const staffAgain = store.reply(ticket.id, { authorRole: 'staff', authorId: 'staff_anna', body: 'Уточните регион' })
    expect(staffAgain.status).toBe('pending')
    const reopened = store.reply(ticket.id, { authorRole: 'customer', authorId: 'tenant_acme', body: 'Добавил логи' })
    expect(reopened.status).toBe('open')
    expect(reopened.messages).toHaveLength(4)
    expect(reopened.updatedAt > ticket.updatedAt).toBe(true)
  })

  it('rejects a reply that names neither side', () => {
    const store = createTicketStore({ now: tickingClock() })
    const ticket = openTicket(store)
    expect(
      errorCode(() =>
        store.reply(ticket.id, { authorRole: 'robot' as unknown as 'staff', authorId: 'staff_anna', body: 'Привет' }),
      ),
    ).toBe('invalid_input')
    expect(
      errorCode(() => store.reply(ticket.id, { authorRole: 'staff', authorId: '   ', body: 'Привет' })),
    ).toBe('invalid_input')
  })

  it('resolves a ticket once and refuses a reply afterwards', () => {
    const store = createTicketStore({ now: tickingClock() })
    const ticket = openTicket(store)
    const resolved = store.resolve(ticket.id, 'staff_anna')
    expect(resolved.status).toBe('resolved')
    expect(resolved.messages).toHaveLength(1)
    expect(resolved.updatedAt > ticket.updatedAt).toBe(true)
    expect(
      errorCode(() => store.reply(ticket.id, { authorRole: 'customer', authorId: 'tenant_acme', body: 'Ещё вопрос' })),
    ).toBe('invalid_state')
    expect(errorCode(() => store.resolve(ticket.id, 'staff_anna'))).toBe('invalid_state')
  })

  it('rejects a resolution without a staff id', () => {
    const store = createTicketStore({ now: tickingClock() })
    const ticket = openTicket(store)
    expect(errorCode(() => store.resolve(ticket.id, '  '))).toBe('invalid_input')
    expect(store.get(ticket.id)!.status).toBe('open')
  })

  it('lists newest first with filters and a limit', () => {
    const store = createTicketStore({ now: tickingClock() })
    const first = openTicket(store, { subject: 'Первый вопрос' })
    const second = openTicket(store, { tenantId: 'tenant_other', subject: 'Чужой вопрос' })
    const third = openTicket(store, { subject: 'Третий вопрос' })
    store.resolve(second.id, 'staff_anna')

    expect(store.list().map((ticket) => ticket.id)).toEqual([third.id, second.id, first.id])
    expect(store.list({ tenantId: 'tenant_acme' }).map((ticket) => ticket.id)).toEqual([third.id, first.id])
    expect(store.list({ status: 'resolved' }).map((ticket) => ticket.id)).toEqual([second.id])
    expect(store.list({ limit: 2 }).map((ticket) => ticket.id)).toEqual([third.id, second.id])
    expect(store.list({ limit: 0 })).toEqual([])
  })

  it('rejects an unknown status filter', () => {
    const store = createTicketStore({ now: tickingClock() })
    expect(errorCode(() => store.list({ status: 'closed' as unknown as 'open' }))).toBe('invalid_input')
  })

  it('returns null for an unknown ticket and copies from get', () => {
    const store = createTicketStore({ now: tickingClock() })
    const ticket = openTicket(store)
    expect(store.get('tkt_missing')).toBeNull()
    const copy = store.get(ticket.id)!
    copy.status = 'resolved'
    copy.messages.push({ id: 'msg_x', authorRole: 'staff', authorId: 'staff_anna', body: 'x', createdAt: ticket.createdAt })
    expect(store.get(ticket.id)!.status).toBe('open')
    expect(store.get(ticket.id)!.messages).toHaveLength(1)
    expect(store.tickets[0]!.messages).toHaveLength(1)
  })
})

describe('incidents', () => {
  it('opens an incident in investigating with the first timeline entry', () => {
    const store = createIncidentStore({ now: tickingClock() })
    const incident = openIncident(store)
    expect(incident.status).toBe('investigating')
    expect(incident.createdAt).toBe(incident.updatedAt)
    expect(incident.timeline).toHaveLength(1)
    expect(incident.timeline[0]!.status).toBe('investigating')
    expect(incident.timeline[0]!.note).toBe(incident.publicSummary)
    expect(incident.scopes).toEqual([{ region: 'eu-1', product: 'sandboxes' }])
  })

  it('moves forward through identified and monitoring', () => {
    const store = createIncidentStore({ now: tickingClock() })
    const incident = openIncident(store)
    const identified = store.update(incident.id, { status: 'identified', note: 'Причина — перегрузка узла' })
    expect(identified.status).toBe('identified')
    const monitoring = store.update(incident.id, { status: 'monitoring', note: 'Узел заменён' })
    expect(monitoring.status).toBe('monitoring')
    expect(monitoring.timeline.map((entry) => entry.status)).toEqual([
      'investigating',
      'identified',
      'monitoring',
    ])
    expect(monitoring.updatedAt > incident.updatedAt).toBe(true)
  })

  it('rejects a step backwards', () => {
    const store = createIncidentStore({ now: tickingClock() })
    const incident = openIncident(store)
    store.update(incident.id, { status: 'monitoring', note: 'Узел заменён' })
    expect(errorCode(() => store.update(incident.id, { status: 'identified', note: 'Назад' }))).toBe('invalid_state')
  })

  it('allows a note without moving the status', () => {
    const store = createIncidentStore({ now: tickingClock() })
    const incident = openIncident(store)
    const same = store.update(incident.id, { status: 'investigating', note: 'Собрали метрики' })
    expect(same.status).toBe('investigating')
    expect(same.timeline.map((entry) => entry.note)).toEqual([incident.publicSummary, 'Собрали метрики'])
  })

  it('rejects an update without a note or with an unknown status', () => {
    const store = createIncidentStore({ now: tickingClock() })
    const incident = openIncident(store)
    expect(errorCode(() => store.update(incident.id, { status: 'identified', note: '  ' }))).toBe('invalid_input')
    expect(
      errorCode(() => store.update(incident.id, { status: 'postmortem' as unknown as 'identified', note: 'Итог' })),
    ).toBe('invalid_input')
  })

  it('closes an incident and freezes it', () => {
    const store = createIncidentStore({ now: tickingClock() })
    const incident = openIncident(store)
    const resolved = store.resolve(incident.id, 'Всё восстановлено')
    expect(resolved.status).toBe('resolved')
    expect(resolved.timeline.at(-1)).toMatchObject({ status: 'resolved', note: 'Всё восстановлено' })
    expect(errorCode(() => store.update(incident.id, { status: 'monitoring', note: 'Снова' }))).toBe('invalid_state')
    expect(errorCode(() => store.resolve(incident.id, 'Ещё раз'))).toBe('invalid_state')
  })

  it('shows only the five public fields', () => {
    const store = createIncidentStore({ now: tickingClock() })
    const incident = openIncident(store)
    store.update(incident.id, { status: 'identified', note: 'Причина найдена на узле eu-1' })
    const view = store.publicView()
    expect(view).toHaveLength(1)
    expect(Object.keys(view[0]!).sort()).toEqual([
      'publicSummary',
      'severity',
      'status',
      'title',
      'updatedAt',
    ])
    expect(view[0]!.status).toBe('identified')
    const serialized = JSON.stringify(view)
    expect(serialized).not.toContain('eu-1')
    expect(serialized).not.toContain('sandboxes')
    expect(serialized).not.toContain('Причина найдена')
    expect(serialized).not.toContain(incident.id)
  })

  it('lists incidents newest first, staff view and public view alike', () => {
    const store = createIncidentStore({ now: tickingClock() })
    const first = openIncident(store, { title: 'Первый случай' })
    const second = openIncident(store, { title: 'Второй случай' })
    expect(store.list().map((incident) => incident.id)).toEqual([second.id, first.id])
    expect(store.publicView().map((incident) => incident.title)).toEqual(['Второй случай', 'Первый случай'])
  })

  it('rejects invalid incident input', () => {
    const store = createIncidentStore({ now: tickingClock() })
    expect(errorCode(() => openIncident(store, { title: '  ' }))).toBe('invalid_input')
    expect(errorCode(() => openIncident(store, { publicSummary: '' }))).toBe('invalid_input')
    expect(errorCode(() => openIncident(store, { severity: 'apocalyptic' as unknown as IncidentSeverity }))).toBe(
      'invalid_input',
    )
    expect(errorCode(() => openIncident(store, { scopes: [{}] }))).toBe('invalid_input')
    expect(errorCode(() => openIncident(store, { scopes: [{ region: '   ' }] }))).toBe('invalid_input')
    expect(
      errorCode(() => openIncident(store, { scopes: [{ datacenter: 'eu-1' } as unknown as IncidentScope] })),
    ).toBe('invalid_input')
    expect(store.incidents).toHaveLength(0)
  })

  it('accepts a platform-wide incident without scopes', () => {
    const store = createIncidentStore({ now: tickingClock() })
    expect(openIncident(store, { scopes: [] }).scopes).toEqual([])
  })

  it('rejects a key marker in a title, a summary or a note', () => {
    const store = createIncidentStore({ now: tickingClock() })
    expect(errorCode(() => openIncident(store, { title: 'Ключ sk-live-1 протёк' }))).toBe('secret_in_record')
    expect(errorCode(() => openIncident(store, { publicSummary: 'rox_sk_1 в логах' }))).toBe('secret_in_record')
    const incident = openIncident(store)
    expect(errorCode(() => store.update(incident.id, { status: 'identified', note: 'Bearer abc' }))).toBe(
      'secret_in_record',
    )
    expect(errorCode(() => store.resolve(incident.id, 'sk-live-1'))).toBe('secret_in_record')
  })

  it('returns copies that cannot mutate the store', () => {
    const store = createIncidentStore({ now: tickingClock() })
    const incident = openIncident(store)
    const copy = store.list()[0]!
    copy.status = 'resolved'
    copy.scopes[0]!.region = 'us-1'
    copy.timeline.length = 0
    const fresh = store.list()[0]!
    expect(fresh.status).toBe('investigating')
    expect(fresh.scopes[0]!.region).toBe('eu-1')
    expect(fresh.timeline).toHaveLength(1)
    expect(store.incidents[0]!.id).toBe(incident.id)
  })
})

describe('abuse evaluation', () => {
  it('returns none below every threshold', () => {
    expect(evaluateSample(sample(), THRESHOLDS)).toBe('none')
  })

  it('warns on one sample above the CPU threshold', () => {
    expect(evaluateSample(sample({ cpuPct: 95 }), THRESHOLDS)).toBe('warn')
  })

  it('stops on two consecutive CPU samples above the threshold', () => {
    const history = [sample({ cpuPct: 95, at: '2026-11-19T10:00:00.000Z' })]
    expect(evaluateSample(sample({ cpuPct: 96, at: '2026-11-19T10:01:00.000Z' }), THRESHOLDS, history)).toBe('stop')
  })

  it('warns when the previous CPU sample was below the threshold', () => {
    const history = [sample({ cpuPct: 50, at: '2026-11-19T10:00:00.000Z' })]
    expect(evaluateSample(sample({ cpuPct: 95, at: '2026-11-19T10:01:00.000Z' }), THRESHOLDS, history)).toBe('warn')
  })

  it('ignores history from another sandbox or another tenant', () => {
    const otherSandbox = [sample({ sandboxId: 'sbx_2', cpuPct: 99 })]
    const otherTenant = [sample({ tenantId: 'tenant_other', cpuPct: 99 })]
    expect(evaluateSample(sample({ cpuPct: 95 }), THRESHOLDS, otherSandbox)).toBe('warn')
    expect(evaluateSample(sample({ cpuPct: 95 }), THRESHOLDS, otherTenant)).toBe('warn')
  })

  it('stops on egress or outbound connections above the threshold', () => {
    expect(evaluateSample(sample({ egressBytesPerMin: 2_000_000 }), THRESHOLDS)).toBe('stop')
    expect(evaluateSample(sample({ outboundConnections: 501 }), THRESHOLDS)).toBe('stop')
  })

  it('treats a value exactly at the threshold as inside the ceiling', () => {
    expect(evaluateSample(sample({ cpuPct: 90, egressBytesPerMin: 1_000_000, outboundConnections: 500 }), THRESHOLDS)).toBe(
      'none',
    )
    const history = [sample({ cpuPct: 90 })]
    expect(evaluateSample(sample({ cpuPct: 90 }), THRESHOLDS, history)).toBe('none')
  })

  it('rejects a malformed sample or threshold', () => {
    expect(errorCode(() => evaluateSample(sample({ cpuPct: -1 }), THRESHOLDS))).toBe('invalid_input')
    expect(errorCode(() => evaluateSample(sample({ at: 'вчера' }), THRESHOLDS))).toBe('invalid_input')
    expect(errorCode(() => evaluateSample(sample(), { ...THRESHOLDS, egressBytesPerMin: -5 }))).toBe('invalid_input')
  })
})

describe('abuse queue', () => {
  it('records a flag with numbers-only evidence', () => {
    const queue = createAbuseQueue({ now: tickingClock() })
    const flag = queue.record(sample({ cpuPct: 96, egressBytesPerMin: 2_000_000 }), THRESHOLDS)
    expect(flag.decision).toBe('stop')
    expect(flag.state).toBe('open')
    expect(flag.tenantId).toBe('tenant_acme')
    expect(flag.sandboxId).toBe('sbx_1')
    expect(flag.at).toBe('2026-11-19T10:00:00.000Z')
    expect(flag.reason).toContain('исходящий трафик')
    expect(Object.keys(flag.evidence).sort()).toEqual([
      'cpuPct',
      'egressBytesPerMin',
      'outboundConnections',
      'thresholds',
    ])
    expect(collectLeaves(flag.evidence).every((leaf) => typeof leaf === 'number')).toBe(true)
  })

  it('uses the queue history for the consecutive CPU rule', () => {
    const queue = createAbuseQueue({ now: tickingClock() })
    const first = queue.record(sample({ at: '2026-11-19T10:00:00.000Z', cpuPct: 95 }), THRESHOLDS)
    expect(first.decision).toBe('warn')
    const second = queue.record(sample({ at: '2026-11-19T10:01:00.000Z', cpuPct: 97 }), THRESHOLDS)
    expect(second.decision).toBe('stop')
    expect(second.evidence.previousCpuPct).toBe(95)
  })

  it('lists newest first and filters by tenant and decision', () => {
    const queue = createAbuseQueue({ now: tickingClock() })
    const quiet = queue.record(sample({ at: '2026-11-19T10:00:00.000Z' }), THRESHOLDS)
    const warn = queue.record(sample({ at: '2026-11-19T10:01:00.000Z', cpuPct: 95 }), THRESHOLDS)
    const other = queue.record(
      sample({ tenantId: 'tenant_other', at: '2026-11-19T10:02:00.000Z', egressBytesPerMin: 5_000_000 }),
      THRESHOLDS,
    )
    expect(quiet.decision).toBe('none')
    expect(queue.list().map((flag) => flag.id)).toEqual([other.id, warn.id, quiet.id])
    expect(queue.list({ tenantId: 'tenant_acme' }).map((flag) => flag.id)).toEqual([warn.id, quiet.id])
    expect(queue.list({ decision: 'stop' }).map((flag) => flag.id)).toEqual([other.id])
    expect(errorCode(() => queue.list({ decision: 'ban' as unknown as AbuseDecision }))).toBe('invalid_input')
  })

  it('dismisses a flag with a reason', () => {
    const queue = createAbuseQueue({ now: tickingClock() })
    const flag = queue.record(sample({ cpuPct: 95 }), THRESHOLDS)
    const dismissed = queue.dismiss(flag.id, 'Обычная сборка')
    expect(dismissed.state).toBe('dismissed')
    expect(dismissed.dismissedReason).toBe('Обычная сборка')
    expect(typeof dismissed.decidedAt).toBe('string')
  })

  it('confirms a flag with a staff id', () => {
    const queue = createAbuseQueue({ now: tickingClock() })
    const flag = queue.record(sample({ cpuPct: 95 }), THRESHOLDS)
    const confirmed = queue.confirm(flag.id, 'staff_anna')
    expect(confirmed.state).toBe('confirmed')
    expect(confirmed.confirmedBy).toBe('staff_anna')
    expect(typeof confirmed.decidedAt).toBe('string')
  })

  it('refuses a second decision and an empty reason', () => {
    const queue = createAbuseQueue({ now: tickingClock() })
    const flag = queue.record(sample({ cpuPct: 95 }), THRESHOLDS)
    expect(errorCode(() => queue.dismiss(flag.id, '  '))).toBe('invalid_input')
    expect(errorCode(() => queue.confirm(flag.id, '  '))).toBe('invalid_input')
    queue.dismiss(flag.id, 'Ложная тревога')
    expect(errorCode(() => queue.confirm(flag.id, 'staff_anna'))).toBe('invalid_state')
    expect(errorCode(() => queue.dismiss(flag.id, 'Ещё раз'))).toBe('invalid_state')
  })

  it('refuses to confirm a quiet sample', () => {
    const queue = createAbuseQueue({ now: tickingClock() })
    const quiet = queue.record(sample(), THRESHOLDS)
    expect(errorCode(() => queue.confirm(quiet.id, 'staff_anna'))).toBe('invalid_state')
    expect(queue.dismiss(quiet.id, 'Нагрузки не было').state).toBe('dismissed')
  })

  it('rejects an unknown flag id', () => {
    const queue = createAbuseQueue({ now: tickingClock() })
    expect(errorCode(() => queue.dismiss('flag_missing', 'x'))).toBe('not_found')
    expect(errorCode(() => queue.confirm('flag_missing', 'staff_anna'))).toBe('not_found')
  })

  it('rejects a key marker in a dismiss reason', () => {
    const queue = createAbuseQueue({ now: tickingClock() })
    const flag = queue.record(sample({ cpuPct: 95 }), THRESHOLDS)
    expect(errorCode(() => queue.dismiss(flag.id, 'Ключ sk-live-1 удалён'))).toBe('secret_in_record')
    expect(queue.list()[0]!.state).toBe('open')
  })

  it('returns copies that cannot mutate the queue', () => {
    const queue = createAbuseQueue({ now: tickingClock() })
    const flag = queue.record(sample({ cpuPct: 95 }), THRESHOLDS)
    flag.evidence.cpuPct = 0
    flag.evidence.thresholds.cpuPct = 0
    flag.state = 'dismissed'
    const fresh = queue.list()[0]!
    expect(fresh.evidence.cpuPct).toBe(95)
    expect(fresh.evidence.thresholds.cpuPct).toBe(90)
    expect(fresh.state).toBe('open')
    expect(queue.flags[0]!.evidence.cpuPct).toBe(95)
  })
})

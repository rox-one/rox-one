import { A } from '@solidjs/router'
import { Show, createEffect, createMemo, createSignal, on } from 'solid-js'
import type { JSX } from 'solid-js'

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Table,
  Tabs,
} from '@/components'
import type { TableColumn } from '@/components'
import { api } from '@/lib/api'
import type { AuditEntry, RequestLogRow } from '@/lib/api'
import { formatDate, shortId } from '@/lib/format'

import { AdminError } from './components/AdminError'
import { adminRefreshTick, auditActionLabel, handleAdminError } from './components/adminSession'
import { downloadCsv, dateStamp } from './components/ops/csv'
import { statusTone } from './components/ops/labels'

import './logs.css'

type TabId = 'actions' | 'requests'

const LIMITS = ['50', '100', '200', '500']
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/** Every action the audit trail can carry; a new server action is still printed by code. */
const AUDIT_ACTIONS = [
  'sandbox.create',
  'sandbox.stop',
  'sandbox.delete',
  'sandbox.extend',
  'credit.grant',
  'tenant.credit',
  'tenant.limits',
  'tenant.rotate_key',
  'impersonate.start',
  'killswitch.set',
  'killswitch.approve',
  'ticket.open',
  'ticket.reply',
  'ticket.resolve',
  'incident.open',
  'incident.update',
  'incident.resolve',
  'abuse.confirm',
  'abuse.dismiss',
]

interface ActionFilters {
  tenant: string
  action: string
  since: string
  limit: string
}

const NO_ACTION_FILTERS: ActionFilters = { tenant: '', action: '', since: '', limit: '100' }

function requestIdOf(row: RequestLogRow): string | null {
  const value = row['request_id']
  return typeof value === 'string' && value.length > 0 ? value : null
}

function formatMillis(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} мс`
  return `${(ms / 1000).toFixed(2).replace('.', ',')} с`
}

function detailsJson(details: Record<string, unknown> | null | undefined): string | null {
  if (details === null || details === undefined) return null
  return JSON.stringify(details, null, 2)
}

export default function AdminLogs(): JSX.Element {
  const [tab, setTab] = createSignal<TabId>('actions')

  // ---------- actions journal ----------
  const [actions, setActions] = createSignal<AuditEntry[]>([])
  const [actionsLoading, setActionsLoading] = createSignal(true)
  const [actionsLoaded, setActionsLoaded] = createSignal(false)
  const [actionsError, setActionsError] = createSignal<string | null>(null)
  const [tenantDraft, setTenantDraft] = createSignal('')
  const [actionDraft, setActionDraft] = createSignal('')
  const [sinceDraft, setSinceDraft] = createSignal('')
  const [limitDraft, setLimitDraft] = createSignal('100')
  const [actionFilters, setActionFilters] = createSignal<ActionFilters>(NO_ACTION_FILTERS)

  // ---------- requests journal ----------
  const [requests, setRequests] = createSignal<RequestLogRow[]>([])
  const [capacity, setCapacity] = createSignal<number | null>(null)
  const [requestsLoading, setRequestsLoading] = createSignal(false)
  const [requestsLoaded, setRequestsLoaded] = createSignal(false)
  const [requestsError, setRequestsError] = createSignal<string | null>(null)
  const [requestLimit, setRequestLimit] = createSignal('200')
  const [requestLimitDraft, setRequestLimitDraft] = createSignal('200')
  const [methodFilter, setMethodFilter] = createSignal('')
  const [statusFilter, setStatusFilter] = createSignal('')
  const [pathFilter, setPathFilter] = createSignal('')
  const [requestTenant, setRequestTenant] = createSignal('')

  const loadActions = async (): Promise<void> => {
    const filters = actionFilters()
    setActionsLoading(true)
    setActionsError(null)
    let since: string | undefined
    if (filters.since.length > 0) {
      const parsed = new Date(filters.since)
      if (Number.isNaN(parsed.getTime())) {
        setActionsError('Дата «с начала» не разобрана: выберите её в поле ещё раз.')
        setActions([])
        setActionsLoading(false)
        setActionsLoaded(true)
        return
      }
      since = parsed.toISOString()
    }
    try {
      const response = await api.admin.audit({
        limit: Number(filters.limit),
        tenant: filters.tenant,
        action: filters.action,
        since,
      })
      setActions(Array.isArray(response.data) ? response.data : [])
    } catch (err) {
      setActionsError(handleAdminError(err))
      setActions([])
    } finally {
      setActionsLoading(false)
      setActionsLoaded(true)
    }
  }

  const loadRequests = async (): Promise<void> => {
    setRequestsLoading(true)
    setRequestsError(null)
    try {
      const response = await api.admin.requests({ limit: Number(requestLimit()) })
      setRequests(Array.isArray(response.data) ? response.data : [])
      setCapacity(typeof response.capacity === 'number' ? response.capacity : null)
    } catch (err) {
      setRequestsError(handleAdminError(err))
      setRequests([])
    } finally {
      setRequestsLoading(false)
      setRequestsLoaded(true)
    }
  }

  createEffect(
    on(adminRefreshTick, () => {
      void loadActions()
      if (requestsLoaded()) void loadRequests()
    }),
  )

  const switchTab = (next: TabId): void => {
    setTab(next)
    if (next === 'requests' && !requestsLoaded()) void loadRequests()
  }

  const refresh = (): void => {
    if (tab() === 'actions') void loadActions()
    else void loadRequests()
  }

  const applyActionFilters = (event: SubmitEvent): void => {
    event.preventDefault()
    setActionFilters({
      tenant: tenantDraft().trim(),
      action: actionDraft(),
      since: sinceDraft(),
      limit: limitDraft(),
    })
    void loadActions()
  }

  const resetActionFilters = (): void => {
    setTenantDraft('')
    setActionDraft('')
    setSinceDraft('')
    setLimitDraft('100')
    setActionFilters(NO_ACTION_FILTERS)
    void loadActions()
  }

  const applyRequestLimit = (event: SubmitEvent): void => {
    event.preventDefault()
    setRequestLimit(requestLimitDraft())
    void loadRequests()
  }

  const filteredRequests = createMemo(() => {
    const method = methodFilter()
    const status = statusFilter()
    const path = pathFilter().trim().toLowerCase()
    const tenant = requestTenant().trim().toLowerCase()
    return requests().filter((row) => {
      if (method !== '' && row.method !== method) return false
      if (status !== '' && String(Math.floor(row.status / 100)) !== status) return false
      if (path !== '' && !row.path.toLowerCase().includes(path)) return false
      if (tenant !== '' && !(row.tenant_id ?? '').toLowerCase().includes(tenant)) return false
      return true
    })
  })

  const actionsFiltered = (): boolean => {
    const filters = actionFilters()
    return filters.tenant.length > 0 || filters.action.length > 0 || filters.since.length > 0
  }

  const requestsFiltered = (): boolean =>
    methodFilter().length > 0 ||
    statusFilter().length > 0 ||
    pathFilter().trim().length > 0 ||
    requestTenant().trim().length > 0

  const resetRequestFilters = (): void => {
    setMethodFilter('')
    setStatusFilter('')
    setPathFilter('')
    setRequestTenant('')
  }

  const downloadActions = (): void => {
    downloadCsv(
      `rox-audit-${dateStamp()}.csv`,
      ['at', 'actor_id', 'action', 'target_type', 'target_id', 'reason', 'ticket', 'details'],
      actions().map((entry) => [
        entry.at,
        entry.actor_id,
        entry.action,
        entry.target_type,
        entry.target_id,
        entry.reason,
        entry.ticket ?? '',
        entry.details === null || entry.details === undefined ? '' : JSON.stringify(entry.details),
      ]),
    )
  }

  const downloadRequests = (): void => {
    downloadCsv(
      `rox-requests-${dateStamp()}.csv`,
      ['at', 'method', 'path', 'status', 'duration_ms', 'tenant_id', 'key_last4', 'request_id'],
      filteredRequests().map((row) => [
        row.at,
        row.method,
        row.path,
        row.status,
        row.duration_ms ?? '',
        row.tenant_id ?? '',
        row.key_last4 ?? '',
        requestIdOf(row) ?? '',
      ]),
    )
  }

  const actionColumns: TableColumn<AuditEntry>[] = [
    { key: 'at', label: 'Время', render: (entry) => <span class="logs-when">{formatDate(entry.at)}</span> },
    {
      key: 'actor_id',
      label: 'Автор',
      render: (entry) => (
        <span class="mono logs-author" title={entry.actor_id}>
          {entry.actor_id}
        </span>
      ),
    },
    {
      key: 'action',
      label: 'Действие',
      render: (entry) => (
        <span class="logs-action">
          <span>{auditActionLabel(entry.action)}</span>
          <span class="logs-code">{entry.action}</span>
        </span>
      ),
    },
    {
      key: 'target_id',
      label: 'Объект',
      render: (entry) => (
        <span class="logs-target" title={`${entry.target_type}: ${entry.target_id}`}>
          {entry.target_type}: {shortId(entry.target_id, 14)}
        </span>
      ),
    },
    { key: 'reason', label: 'Причина', render: (entry) => <span class="logs-reason">{entry.reason}</span> },
    {
      key: 'details',
      label: 'Подробности',
      render: (entry) => {
        const json = detailsJson(entry.details)
        if (json === null) return <span class="muted">—</span>
        return (
          <details class="logs-json">
            <summary>Показать</summary>
            <pre>{json}</pre>
          </details>
        )
      },
    },
  ]

  const requestColumns: TableColumn<RequestLogRow>[] = [
    { key: 'at', label: 'Время', render: (row) => <span class="logs-when">{formatDate(row.at)}</span> },
    { key: 'method', label: 'Метод', render: (row) => <span class="logs-method">{row.method}</span> },
    {
      key: 'path',
      label: 'Путь',
      render: (row) => (
        <span class="mono logs-path" title={row.path}>
          {row.path}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Код',
      render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge>,
    },
    {
      key: 'duration_ms',
      label: 'Длительность',
      align: 'right',
      render: (row) => <span class="logs-when">{formatMillis(row.duration_ms)}</span>,
    },
    {
      key: 'tenant_id',
      label: 'Клиент',
      render: (row) =>
        row.tenant_id === null || row.tenant_id === undefined ? (
          <span class="muted">—</span>
        ) : (
          <A
            class="mono logs-tenant"
            href={`/admin/clients/${encodeURIComponent(row.tenant_id)}`}
            title={row.tenant_id}
          >
            {shortId(row.tenant_id, 12)}
          </A>
        ),
    },
    {
      key: 'key_last4',
      label: 'Ключ',
      render: (row) => (
        <span class="mono logs-key">{row.key_last4 === null || row.key_last4 === undefined ? '—' : `…${row.key_last4}`}</span>
      ),
    },
    {
      key: 'request_id',
      label: 'Номер запроса',
      render: (row) => {
        const id = requestIdOf(row)
        return id === null ? (
          <span class="muted">—</span>
        ) : (
          <span class="mono logs-request-id" title={id}>
            {id}
          </span>
        )
      },
    },
  ]

  return (
    <section class="page logs-page">
      <PageHeader
        eyebrow="Журналы"
        title="Журналы"
        description="Два разных журнала: действия дежурных сохраняются на диск, запросы API живут в памяти с момента запуска сервера. Тела запросов и заголовок Authorization не пишутся никогда."
        actions={
          <Button variant="secondary" loading={tab() === 'actions' ? actionsLoading() : requestsLoading()} onClick={refresh}>
            Обновить
          </Button>
        }
      />

      <Tabs
        label="Журналы панели"
        active={tab()}
        onChange={(id) => switchTab(id as TabId)}
        items={[
          {
            id: 'actions',
            label: 'Действия',
            count: actionsLoaded() ? actions().length : undefined,
          },
          {
            id: 'requests',
            label: 'Запросы',
            count: requestsLoaded() ? requests().length : undefined,
          },
        ]}
      />

      <Show when={tab() === 'actions'}>
        <Card class="logs-filters-card" bodyClass="logs-filters-body">
          <form class="logs-filters" aria-label="Фильтры журнала действий" onSubmit={applyActionFilters}>
            <Field label="Клиент или объект" for="logs-tenant" hint="точный id">
              <input
                id="logs-tenant"
                class="input"
                type="text"
                value={tenantDraft()}
                placeholder="любой"
                autocomplete="off"
                spellcheck={false}
                onInput={(event) => setTenantDraft(event.currentTarget.value)}
              />
            </Field>
            <Field label="Действие" for="logs-action">
              <Select
                id="logs-action"
                class="select"
                placeholder="любое"
                options={AUDIT_ACTIONS.map((value) => ({ value, label: `${auditActionLabel(value)} · ${value}` }))}
                value={actionDraft()}
                onChange={(event) => setActionDraft(event.currentTarget.value)}
              />
            </Field>
            <Field label="С начала" for="logs-since" hint="местное время">
              <input
                id="logs-since"
                class="input"
                type="datetime-local"
                value={sinceDraft()}
                onInput={(event) => setSinceDraft(event.currentTarget.value)}
              />
            </Field>
            <Field label="Записей" for="logs-limit">
              <Select
                id="logs-limit"
                class="select"
                options={LIMITS.map((limit) => ({ value: limit, label: limit }))}
                value={limitDraft()}
                onChange={(event) => setLimitDraft(event.currentTarget.value)}
              />
            </Field>
            <div class="logs-filter-actions">
              <Button type="submit" variant="primary" loading={actionsLoading()}>
                Показать
              </Button>
              <Show when={actionsFiltered()}>
                <Button variant="ghost" onClick={resetActionFilters}>
                  Сбросить
                </Button>
              </Show>
            </div>
          </form>
        </Card>

        <div class="logs-toolbar">
          <p class="logs-note">
            Полный журнал действий: кто, что и почему. Новые записи сверху.
          </p>
          <Button size="sm" variant="secondary" onClick={downloadActions} disabled={actions().length === 0}>
            Скачать CSV
          </Button>
        </div>

        <AdminError text={actionsError()} onRetry={() => void loadActions()} />

        <Show
          when={actions().length > 0 || actionsLoading()}
          fallback={
            <Card class="logs-empty-card">
              <EmptyState
                icon="log"
                title={actionsFiltered() ? 'По этим условиям записей нет' : 'Журнал пока пуст'}
                description={
                  actionsFiltered()
                    ? 'Проверьте id объекта, действие и дату «с начала»: фильтры уходят на сервер и ищут точное совпадение.'
                    : 'Первое действие дежурного — пополнение, остановка машины или ответ по обращению — появится здесь.'
                }
              />
            </Card>
          }
        >
          <Table label="Журнал действий" columns={actionColumns} rows={actions()} loading={actionsLoading()} />
        </Show>
      </Show>

      <Show when={tab() === 'requests'}>
        <Card class="logs-filters-card" bodyClass="logs-filters-body">
          <form class="logs-filters" aria-label="Фильтры журнала запросов" onSubmit={applyRequestLimit}>
            <Field label="Загрузить" for="logs-request-limit" hint="последних записей">
              <Select
                id="logs-request-limit"
                class="select"
                options={LIMITS.map((limit) => ({ value: limit, label: limit }))}
                value={requestLimitDraft()}
                onChange={(event) => setRequestLimitDraft(event.currentTarget.value)}
              />
            </Field>
            <Field label="Метод" for="logs-request-method" hint="по загруженным">
              <Select
                id="logs-request-method"
                class="select"
                placeholder="любой"
                options={METHODS.map((method) => ({ value: method, label: method }))}
                value={methodFilter()}
                onChange={(event) => setMethodFilter(event.currentTarget.value)}
              />
            </Field>
            <Field label="Код ответа" for="logs-request-status" hint="по загруженным">
              <Select
                id="logs-request-status"
                class="select"
                placeholder="любой"
                options={[
                  { value: '2', label: '2xx — успех' },
                  { value: '3', label: '3xx — перенаправление' },
                  { value: '4', label: '4xx — ошибка клиента' },
                  { value: '5', label: '5xx — ошибка сервера' },
                ]}
                value={statusFilter()}
                onChange={(event) => setStatusFilter(event.currentTarget.value)}
              />
            </Field>
            <Field label="Путь" for="logs-request-path" hint="часть адреса">
              <input
                id="logs-request-path"
                class="input"
                type="text"
                value={pathFilter()}
                placeholder="например, /v1/sandboxes"
                autocomplete="off"
                spellcheck={false}
                onInput={(event) => setPathFilter(event.currentTarget.value)}
              />
            </Field>
            <Field label="Клиент" for="logs-request-tenant" hint="часть id">
              <input
                id="logs-request-tenant"
                class="input"
                type="text"
                value={requestTenant()}
                placeholder="любой"
                autocomplete="off"
                spellcheck={false}
                onInput={(event) => setRequestTenant(event.currentTarget.value)}
              />
            </Field>
            <div class="logs-filter-actions">
              <Button type="submit" variant="primary" loading={requestsLoading()}>
                Показать
              </Button>
              <Show when={requestsFiltered()}>
                <Button variant="ghost" onClick={resetRequestFilters}>
                  Сбросить
                </Button>
              </Show>
            </div>
          </form>
        </Card>

        <div class="logs-toolbar">
          <p class="logs-note">
            <strong>Журнал запросов — с момента запуска сервера.</strong>{' '}
            {capacity() === null
              ? 'Это кольцо последних вызовов в памяти процесса: после перезапуска сервера журнал начинается заново.'
              : `Это кольцо на ${capacity()} последних вызовов в памяти процесса: после перезапуска сервера журнал начинается заново.`}{' '}
            Сам журнал хранит только метод, путь без строки запроса, код, длительность, клиента, последние четыре символа ключа и номер запроса.
          </p>
          <Button size="sm" variant="secondary" onClick={downloadRequests} disabled={filteredRequests().length === 0}>
            Скачать CSV
          </Button>
        </div>

        <AdminError text={requestsError()} onRetry={() => void loadRequests()} />

        <Show
          when={filteredRequests().length > 0 || requestsLoading()}
          fallback={
            <Card class="logs-empty-card">
              <EmptyState
                icon="log"
                title={requests().length === 0 ? 'Запросов пока нет' : 'По этим условиям запросов нет'}
                description={
                  requests().length === 0
                    ? 'Журнал наполняется вызовами API и начинается заново после перезапуска сервера.'
                    : 'Метод, код, путь и клиент фильтруются только по уже загруженным записям: увеличьте «Загрузить» или сбросьте фильтры.'
                }
                action={
                  <Show when={requests().length > 0 && requestsFiltered()}>
                    <Button variant="secondary" onClick={resetRequestFilters}>
                      Сбросить фильтры
                    </Button>
                  </Show>
                }
              />
            </Card>
          }
        >
          <Table
            label="Журнал запросов API"
            columns={requestColumns}
            rows={filteredRequests()}
            loading={requestsLoading()}
          />
        </Show>
      </Show>
    </section>
  )
}

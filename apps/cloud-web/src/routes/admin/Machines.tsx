import { A } from '@solidjs/router'
import { Show, createEffect, createMemo, createSignal, on } from 'solid-js'
import type { JSX } from 'solid-js'

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Money,
  PageHeader,
  Select,
  Stat,
  Table,
  useToast,
} from '@/components'
import type { TableColumn } from '@/components'
import { api } from '@/lib/api'
import type { AdminResource } from '@/lib/api'
import { formatDate, shortId } from '@/lib/format'

import { AdminError } from './components/AdminError'
import { adminRefreshTick, handleAdminError, sandboxStateLabel, sandboxStateTone } from './components/adminSession'
import { ReasonDialog } from './components/ops/ReasonDialog'

import './machines.css'

const SANDBOX_STATES = [
  'queued',
  'starting',
  'running',
  'paused',
  'stopping',
  'stopped',
  'failed',
  'expired',
] as const

const PROVIDERS = [
  { value: 'daytona', label: 'daytona' },
  { value: 'modal', label: 'modal' },
  { value: 'e2b', label: 'e2b' },
]

interface Filters {
  tenant: string
  provider: string
  state: string
}

const NO_FILTERS: Filters = { tenant: '', provider: '', state: '' }

/** A machine can be stopped while it is queued, starting, running or paused. */
function canStop(state: string): boolean {
  return state !== 'stopped' && state !== 'failed' && state !== 'expired' && state !== 'stopping'
}

function readSpec(row: AdminResource): Record<string, unknown> | null {
  const raw = row['spec']
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as Record<string, unknown>
}

function numberOf(spec: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = spec[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function textOf(spec: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = spec[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function coresWord(count: number): string {
  const tail = count % 100
  if (tail >= 11 && tail <= 14) return 'ядер'
  const last = count % 10
  if (last === 1) return 'ядро'
  if (last >= 2 && last <= 4) return 'ядра'
  return 'ядер'
}

function gpuLine(spec: Record<string, unknown>): string | null {
  const raw = spec['gpu']
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const gpu = raw as Record<string, unknown>
  const type = typeof gpu['type'] === 'string' ? gpu['type'] : null
  if (type === null) return null
  const count = typeof gpu['count'] === 'number' ? gpu['count'] : 1
  return `${count}×${type.toUpperCase()}`
}

/** The machine's composition in one line; `null` when the API sent none. */
function specParts(row: AdminResource): string[] | null {
  const spec = readSpec(row)
  if (spec === null) return null
  const parts: string[] = []
  const cpu = numberOf(spec, 'cpu')
  const memory = numberOf(spec, 'memoryGb', 'memory_gb')
  const disk = numberOf(spec, 'diskGb', 'disk_gb')
  if (cpu !== undefined) parts.push(`${cpu} ${coresWord(cpu)}`)
  if (memory !== undefined) parts.push(`${memory} ГБ памяти`)
  if (disk !== undefined) parts.push(`${disk} ГБ диска`)
  const gpu = gpuLine(spec)
  if (gpu !== null) parts.push(gpu)
  return parts.length === 0 ? null : parts
}

export default function AdminMachines(): JSX.Element {
  const toast = useToast()

  const [rows, setRows] = createSignal<AdminResource[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  const [tenantDraft, setTenantDraft] = createSignal('')
  const [providerDraft, setProviderDraft] = createSignal('')
  const [stateDraft, setStateDraft] = createSignal('')
  const [applied, setApplied] = createSignal<Filters>(NO_FILTERS)

  const [stopTarget, setStopTarget] = createSignal<AdminResource | null>(null)
  const [stopping, setStopping] = createSignal(false)
  const [stopError, setStopError] = createSignal<string | null>(null)

  const load = async (): Promise<void> => {
    const filters = applied()
    setLoading(true)
    setError(null)
    try {
      const response = await api.admin.resources({
        tenant: filters.tenant,
        provider: filters.provider,
        state: filters.state,
      })
      setRows(Array.isArray(response.data) ? response.data : [])
    } catch (err) {
      setError(handleAdminError(err))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  createEffect(on(adminRefreshTick, () => void load()))

  const summary = createMemo(() => {
    const list = rows()
    return {
      total: list.length,
      running: list.filter((row) => row.state === 'running').length,
      spend: list.reduce((sum, row) => sum + (typeof row.cost_cents === 'number' ? row.cost_cents : 0), 0),
    }
  })

  const filtered = (): boolean => {
    const filters = applied()
    return filters.tenant.length > 0 || filters.provider.length > 0 || filters.state.length > 0
  }

  const applyFilters = (event: SubmitEvent): void => {
    event.preventDefault()
    setApplied({
      tenant: tenantDraft().trim(),
      provider: providerDraft(),
      state: stateDraft(),
    })
    void load()
  }

  const resetFilters = (): void => {
    setTenantDraft('')
    setProviderDraft('')
    setStateDraft('')
    setApplied(NO_FILTERS)
    void load()
  }

  const openStop = (row: AdminResource): void => {
    setStopError(null)
    setStopTarget(row)
  }

  const closeStop = (): void => {
    if (stopping()) return
    setStopTarget(null)
    setStopError(null)
  }

  const submitStop = async (reason: string): Promise<void> => {
    const target = stopTarget()
    if (target === null) return
    setStopping(true)
    setStopError(null)
    try {
      await api.admin.stopResource(target.id, reason)
      toast.success(`Машина ${shortId(target.id)} остановлена`)
      setStopTarget(null)
      await load()
    } catch (err) {
      setStopError(handleAdminError(err))
    } finally {
      setStopping(false)
    }
  }

  const columns: TableColumn<AdminResource>[] = [
    {
      key: 'id',
      label: 'Машина',
      render: (row) => (
        <span class="mono machines-id" title={row.id}>
          {shortId(row.id, 12)}
        </span>
      ),
    },
    {
      key: 'tenant_id',
      label: 'Клиент',
      render: (row) => (
        <A class="mono machines-tenant" href={`/admin/clients/${encodeURIComponent(row.tenant_id)}`} title={row.tenant_id}>
          {shortId(row.tenant_id, 12)}
        </A>
      ),
    },
    { key: 'provider', label: 'Провайдер' },
    {
      key: 'state',
      label: 'Состояние',
      render: (row) => (
        <Badge tone={sandboxStateTone(row.state)} dot>
          {sandboxStateLabel(row.state)}
        </Badge>
      ),
    },
    {
      key: 'spec',
      label: 'Состав',
      render: (row) => {
        const parts = specParts(row)
        if (parts === null) return <span class="muted">не передан</span>
        return <span class="machines-spec">{parts.join(' · ')}</span>
      },
    },
    {
      key: 'region',
      label: 'Площадка',
      render: (row) => <span class="machines-region">{row.region ?? '—'}</span>,
    },
    {
      key: 'cost_cents',
      label: 'Расход',
      align: 'right',
      render: (row) => (
        <span class="machines-cost">
          <Money cents={row.cost_cents} />
          <Show when={typeof row.rate_cents_per_hour === 'number'}>
            <span class="machines-rate">
              <Money cents={row.rate_cents_per_hour} perHour />
            </span>
          </Show>
        </span>
      ),
    },
    {
      key: 'expires_at',
      label: 'Истекает',
      render: (row) => <span class="machines-when">{formatDate(row.expires_at)}</span>,
    },
    {
      key: 'actions',
      label: 'Действие',
      render: (row) => (
        <Show when={canStop(row.state)} fallback={<span class="muted machines-when">—</span>}>
          <Button size="sm" variant="danger" onClick={() => openStop(row)}>
            Остановить
          </Button>
        </Show>
      ),
    },
  ]

  return (
    <section class="page machines-page">
      <PageHeader
        eyebrow="Машины"
        title="Машины"
        description="Все машины платформы: состав, площадка, расход и срок. Остановка считает плату по ставке машины и пишет причину в журнал."
        actions={
          <Button variant="secondary" loading={loading()} onClick={() => void load()}>
            Обновить
          </Button>
        }
      />

      <div class="machines-stats">
        <Stat label="Машин в списке" value={String(summary().total)} icon="server" />
        <Stat label="Работают" value={String(summary().running)} tone="success" icon="play" />
        <Stat label="Израсходовано" value={<Money cents={summary().spend} />} icon="chart" />
      </div>

      <Card class="machines-filters-card" bodyClass="machines-filters-body">
        <form class="machines-filters" aria-label="Фильтры машин" onSubmit={applyFilters}>
          <Field label="Клиент" for="machines-filter-tenant" hint="Точный id клиента, например guest-…">
            <input
              id="machines-filter-tenant"
              class="input"
              type="text"
              value={tenantDraft()}
              placeholder="все клиенты"
              autocomplete="off"
              spellcheck={false}
              onInput={(event) => setTenantDraft(event.currentTarget.value)}
            />
          </Field>
          <Field label="Провайдер" for="machines-filter-provider">
            <Select
              id="machines-filter-provider"
              class="select"
              placeholder="любой"
              options={PROVIDERS}
              value={providerDraft()}
              onChange={(event) => setProviderDraft(event.currentTarget.value)}
            />
          </Field>
          <Field label="Состояние" for="machines-filter-state">
            <Select
              id="machines-filter-state"
              class="select"
              placeholder="любое"
              options={SANDBOX_STATES.map((state) => ({
                value: state,
                label: `${sandboxStateLabel(state)} · ${state}`,
              }))}
              value={stateDraft()}
              onChange={(event) => setStateDraft(event.currentTarget.value)}
            />
          </Field>
          <div class="machines-filter-actions">
            <Button type="submit" variant="primary" loading={loading()}>
              Показать
            </Button>
            <Show when={filtered()}>
              <Button variant="ghost" onClick={resetFilters}>
                Сбросить
              </Button>
            </Show>
          </div>
        </form>
      </Card>

      <AdminError text={error()} onRetry={() => void load()} />

      <Show
        when={rows().length > 0 || loading()}
        fallback={
          <Card class="machines-empty-card">
            <EmptyState
              icon="server"
              title={filtered() ? 'По этим условиям машин нет' : 'Машин пока нет'}
              description={
                filtered()
                  ? 'Сбросьте фильтры или проверьте id клиента: фильтр ищет точное совпадение.'
                  : 'Как только клиент запустит машину, она появится здесь вместе с составом и расходом.'
              }
              action={
                <Show when={filtered()}>
                  <Button variant="secondary" onClick={resetFilters}>
                    Сбросить фильтры
                  </Button>
                </Show>
              }
            />
          </Card>
        }
      >
        <Table
          label="Машины платформы"
          columns={columns}
          rows={rows()}
          rowKey={(row) => row.id}
          loading={loading()}
        />
      </Show>

      <ReasonDialog
        open={stopTarget() !== null}
        title={`Остановить машину ${stopTarget() === null ? '' : shortId(stopTarget()?.id, 12)}`}
        subtitle="Машина завершится, плата посчитается по её ставке за прошедшее время."
        label="Почему останавливаем"
        placeholder="например: клиент попросил в обращении tkt_…"
        hint="Причина сохранится в журнале действий."
        confirmLabel="Остановить"
        danger
        busy={stopping()}
        error={stopError()}
        onSubmit={(reason) => void submitStop(reason)}
        onClose={closeStop}
      />
    </section>
  )
}

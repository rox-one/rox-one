import { A } from '@solidjs/router'
import { Show, createEffect, createMemo, createSignal, on } from 'solid-js'

import {
  Badge,
  Button,
  EmptyState,
  Field,
  Money,
  PageHeader,
  Table,
} from '@/components'
import type { TableColumn } from '@/components'
import { api } from '@/lib/api'
import type { Tenant } from '@/lib/api'

import { AdminError } from './components/AdminError'
import {
  adminRefreshTick,
  capText,
  handleAdminError,
  tenantCount,
  tenantInlineCap,
} from './components/adminSession'

import './clients.css'

export default function AdminClients() {
  const [rows, setRows] = createSignal<Tenant[]>([])
  const [query, setQuery] = createSignal('')
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  let generation = 0

  const visible = createMemo(() => {
    const needle = query().trim().toLowerCase()
    if (needle.length === 0) return rows()
    return rows().filter(
      (tenant) =>
        tenant.name.toLowerCase().includes(needle) || tenant.id.toLowerCase().includes(needle),
    )
  })

  const columns: readonly TableColumn<Tenant>[] = [
    {
      key: 'name',
      label: 'Клиент',
      render: (tenant) => (
        <span class="clients-name">
          <span class="clients-name-row">
            <A href={`/admin/clients/${encodeURIComponent(tenant.id)}`} class="strong">
              {tenant.name}
            </A>
            <Show when={tenant.guest === true}>
              <Badge tone="neutral">гость</Badge>
            </Show>
          </span>
          <span class="tiny muted mono clients-id" title={tenant.id}>
            {tenant.id}
          </span>
        </span>
      ),
    },
    {
      key: 'balance_cents',
      label: 'Баланс',
      align: 'right',
      render: (tenant) => <Money cents={tenant.balance_cents} />,
    },
    {
      key: 'reserved_cents',
      label: 'Резерв',
      align: 'right',
      render: (tenant) => <Money cents={tenant.reserved_cents} />,
    },
    {
      key: 'month_spent_cents',
      label: 'Расход за месяц',
      align: 'right',
      render: (tenant) => <Money cents={tenant.month_spent_cents} />,
    },
    {
      key: 'cap',
      label: 'Потолок клиента',
      align: 'right',
      render: (tenant) => (
        <span class="clients-cap">{capText(tenantInlineCap(tenant))}</span>
      ),
    },
    {
      key: 'keys',
      label: 'Ключи',
      align: 'right',
      render: (tenant) => tenantCount(tenant, 'keys'),
    },
    {
      key: 'sandboxes',
      label: 'Машины',
      align: 'right',
      render: (tenant) => tenantCount(tenant, 'sandboxes'),
    },
    {
      key: 'open',
      label: 'Действие',
      render: (tenant) => (
        <A href={`/admin/clients/${encodeURIComponent(tenant.id)}`} class="clients-open">
          Открыть
        </A>
      ),
    },
  ]

  async function load(): Promise<void> {
    const current = ++generation
    setLoading(true)
    setError(null)
    try {
      const list = await api.admin.tenants()
      if (current !== generation) return
      setRows(list.data ?? [])
    } catch (failure) {
      if (current !== generation) return
      setRows([])
      setError(handleAdminError(failure))
    } finally {
      if (current === generation) setLoading(false)
    }
  }

  createEffect(on(adminRefreshTick, () => void load()))

  return (
    <section class="page clients-page">
      <PageHeader
        eyebrow="Клиенты"
        title="Люди и их счета"
        description="Баланс, резерв, расход за месяц, потолок, ключи и машины. Суммы — в долларах с двумя знаками; резерв уже удержан под работающие машины."
        actions={
          <Button size="sm" variant="secondary" onClick={() => void load()} loading={loading()}>
            Обновить
          </Button>
        }
      />

      <AdminError text={error()} onRetry={() => void load()} />

      <div class="clients-toolbar">
        <Field label="Поиск по имени или идентификатору" for="clients-search">
          <input
            id="clients-search"
            class="input"
            type="search"
            autocomplete="off"
            spellcheck={false}
            placeholder="например, гость или guest-…"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </Field>
        <span class="clients-count tiny muted">
          {visible().length} из {rows().length}
        </span>
      </div>

      <p class="tiny muted clients-hint">
        «Без потолка» значит, что своего месячного ограничения у клиента нет; общий потолок сервера
        при этом действует.
      </p>

      <Table
        label="Клиенты Rox Cloud"
        columns={columns}
        rows={visible()}
        rowKey={(tenant) => tenant.id}
        loading={loading()}
        empty={
          <Show
            when={rows().length === 0}
            fallback={
              <EmptyState
                icon="users"
                title="Ничего не найдено"
                description="Измените поиск: имя или идентификатор клиента."
              />
            }
          >
            <EmptyState
              icon="users"
              title="Клиентов пока нет"
              description="Первый клиент появится, когда человек войдёт в кабинет гостем или получит ключ."
            />
          </Show>
        }
      />
    </section>
  )
}

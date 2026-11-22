import { A } from '@solidjs/router'
import { For, Show, createEffect, createSignal, on } from 'solid-js'

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Money,
  PageHeader,
  Skeleton,
  Stat,
  Table,
} from '@/components'
import type { IconName, TableColumn } from '@/components'
import { ApiError, api } from '@/lib/api'
import type { AdminOverview, AuditEntry } from '@/lib/api'
import { formatDate, shortId } from '@/lib/format'

import { AdminError } from './components/AdminError'
import {
  adminRefreshTick,
  auditActionLabel,
  handleAdminError,
  providerLabel,
} from './components/adminSession'

import './overview.css'

interface QuickLink {
  href: string
  title: string
  text: string
  icon: IconName
}

const quickLinks: readonly QuickLink[] = [
  { href: '/admin/clients', title: 'Клиенты', text: 'Балансы, лимиты, ключи', icon: 'users' },
  { href: '/admin/keys', title: 'Ключи', text: 'Клиентские и поставщиков', icon: 'key' },
  { href: '/admin/machines', title: 'Машины', text: 'Что работает сейчас', icon: 'server' },
  { href: '/admin/logs', title: 'Журналы', text: 'Действия и запросы', icon: 'log' },
  { href: '/admin/security', title: 'Безопасность', text: 'Рубильник и доступ', icon: 'shield' },
]

const auditColumns: readonly TableColumn<AuditEntry>[] = [
  {
    key: 'at',
    label: 'Когда',
    render: (row) => <span class="small">{formatDate(row.at)}</span>,
  },
  {
    key: 'actor_id',
    label: 'Кто',
    render: (row) => <span class="mono small">{row.actor_id}</span>,
  },
  {
    key: 'action',
    label: 'Действие',
    render: (row) => <span class="strong">{auditActionLabel(row.action)}</span>,
  },
  {
    key: 'target_id',
    label: 'Объект',
    render: (row) => (
      <span class="overview-target">
        <span class="mono small" title={row.target_id}>
          {shortId(row.target_id)}
        </span>
        <span class="tiny muted">{row.target_type}</span>
      </span>
    ),
  },
  {
    key: 'reason',
    label: 'Причина',
    render: (row) => <span class="overview-reason">{row.reason}</span>,
  },
]

export default function AdminOverview() {
  const [overview, setOverview] = createSignal<AdminOverview | null>(null)
  const [audit, setAudit] = createSignal<AuditEntry[]>([])
  const [openTickets, setOpenTickets] = createSignal<number | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [auditError, setAuditError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(true)
  let generation = 0

  async function load(): Promise<void> {
    const current = ++generation
    setLoading(true)
    setError(null)
    setAuditError(null)
    const [overviewResult, auditResult, ticketsResult] = await Promise.allSettled([
      api.admin.overview(),
      api.admin.audit({ limit: 8 }),
      api.admin.tickets({ status: 'open' }),
    ])
    if (current !== generation) return
    if (overviewResult.status === 'fulfilled') {
      setOverview(overviewResult.value)
    } else {
      setOverview(null)
      setError(handleAdminError(overviewResult.reason))
    }
    if (auditResult.status === 'fulfilled') {
      setAudit(auditResult.value.data ?? [])
    } else {
      setAudit([])
      setAuditError(handleAdminError(auditResult.reason))
    }
    if (ticketsResult.status === 'fulfilled') {
      setOpenTickets((ticketsResult.value.data ?? []).length)
    } else {
      // The support surface may be switched off on this server; an unknown
      // count is printed as «—», never as a zero.
      setOpenTickets(null)
      if (ticketsResult.reason instanceof ApiError && ticketsResult.reason.status === 401) {
        handleAdminError(ticketsResult.reason)
      }
    }
    setLoading(false)
  }

  createEffect(on(adminRefreshTick, () => void load()))

  return (
    <section class="page overview-page">
      <PageHeader
        eyebrow="Обзор"
        title="Что происходит сейчас"
        description="Клиенты, деньги, ключи и последние действия дежурного. Цифры приходят с сервера; ничего не досчитывается на глаз."
        actions={
          <Button size="sm" variant="secondary" onClick={() => void load()} loading={loading()}>
            Обновить
          </Button>
        }
      />

      <AdminError text={error()} onRetry={() => void load()} />

      <Show
        when={overview()}
        fallback={
          <Show when={loading()}>
            <div class="overview-loading">
              <Skeleton lines={2} />
            </div>
          </Show>
        }
      >
        {(data) => (
          <div class="overview-stats">
            <Stat
              label="Клиенты"
              icon="users"
              value={data().tenants}
              hint={
                typeof data().guests === 'number' ? `из них гостей: ${data().guests}` : 'аккаунты на сервере'
              }
            />
            <Stat
              label="Машины в работе"
              icon="server"
              value={data().active_sandboxes}
              hint="включая запускающиеся и приостановленные"
              tone={data().active_sandboxes > 0 ? 'accent' : 'neutral'}
            />
            <Stat
              label="Ключи поставщиков"
              icon="globe"
              value={data().credentials}
              hint="свои ключи клиентов у площадок"
            />
            <Stat
              label="На счетах клиентов"
              icon="chart"
              value={<Money cents={data().balance_cents_total} />}
              hint="свободные деньги, без резерва"
              tone="accent"
            />
            <Stat
              label="Обращения в работе"
              icon="shield"
              value={openTickets() === null ? '—' : openTickets()}
              hint={
                openTickets() === null
                  ? 'нет данных об обращениях'
                  : 'открытые обращения клиентов'
              }
              tone={openTickets() !== null && openTickets() !== 0 ? 'warning' : 'neutral'}
            />
          </div>
        )}
      </Show>

      <div class="overview-grid">
        <Card
          title="Последние действия"
          subtitle="Восемь самых свежих записей журнала дежурного."
          actions={
            <A href="/admin/logs" class="small">
              Весь журнал
            </A>
          }
        >
          <AdminError text={auditError()} onRetry={() => void load()} />
          <Table
            label="Последние действия дежурного"
            columns={auditColumns}
            rows={audit()}
            rowKey={(row) => row.id}
            loading={loading()}
            empty={
              <EmptyState
                icon="log"
                title="Записей пока нет"
                description="Журнал заполнится, когда дежурный пополнит баланс, перевыпустит ключ или изменит лимиты."
              />
            }
          />
        </Card>

        <div class="overview-side">
          <Card
            title="Платформенный ключ"
            subtitle="Ключ, которым Rox запускает машины за свой счёт (режим managed)."
          >
            <Show
              when={(overview()?.platform_keys ?? []).length > 0}
              fallback={
                <p class="overview-note">
                  {overview()?.platform_keys === undefined
                    ? 'Сервер не сообщил состояние платформенных ключей.'
                    : 'Платформенный ключ Daytona не настроен. Машины за счёт Rox (режим managed) не запустятся, пока ключ не добавят в настройках сервера.'}
                </p>
              }
            >
              <ul class="overview-keys">
                <For each={overview()?.platform_keys ?? []}>
                  {(key) => (
                    <li>
                      <span class="overview-key-name">{providerLabel(key.provider)}</span>
                      <Show
                        when={key.present}
                        fallback={<Badge tone="warning">не настроен</Badge>}
                      >
                        <Badge tone="success" dot>
                          настроен
                        </Badge>
                        <Show when={typeof key.last4 === 'string' && key.last4.length > 0}>
                          <span class="mono small muted">···· {key.last4}</span>
                        </Show>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
              <p class="overview-note">
                Секрет остаётся на сервере; здесь видны только последние четыре символа.
              </p>
            </Show>
            <div class="overview-kill">
              <span class="strong">Рубильник</span>
              <Show
                when={(overview()?.open_kill_switches ?? 0) > 0}
                fallback={<Badge tone="success">выключен</Badge>}
              >
                <Badge tone="danger">
                  {`${overview()?.open_kill_switches ?? 0} ${
                    (overview()?.open_kill_switches ?? 0) === 1 ? 'включён' : 'включены'
                  }`}
                </Badge>
              </Show>
              <A href="/admin/security" class="overview-kill-link">
                Открыть
              </A>
            </div>
          </Card>

          <Card title="Быстрые переходы">
            <div class="overview-links">
              <For each={quickLinks}>
                {(link) => (
                  <A href={link.href} class="overview-link">
                    <span class="overview-link-text">
                      <span class="strong">{link.title}</span>
                      <span class="tiny muted">{link.text}</span>
                    </span>
                    <Icon name={link.icon} size={16} />
                  </A>
                )}
              </For>
            </div>
          </Card>
        </div>
      </div>
    </section>
  )
}

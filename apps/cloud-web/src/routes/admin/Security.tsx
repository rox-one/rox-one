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
  Stat,
  Switch,
  Table,
  Textarea,
  useToast,
} from '@/components'
import type { TableColumn } from '@/components'
import { api } from '@/lib/api'
import type { AuditEntry, KillRequestRow, KillScope } from '@/lib/api'
import { formatDate, shortId } from '@/lib/format'

import { AdminError } from './components/AdminError'
import { adminRefreshTick, auditActionLabel, handleAdminError } from './components/adminSession'
import { killStateInfo } from './components/ops/labels'
import { ReasonDialog } from './components/ops/ReasonDialog'

import './security.css'

const PROVIDERS = [
  { value: 'daytona', label: 'daytona' },
  { value: 'modal', label: 'modal' },
  { value: 'e2b', label: 'e2b' },
]

/** What one block covers, in words: a provider, a region, a product or all. */
function scopeParts(scope: KillScope): string[] {
  const parts: string[] = []
  if (scope.provider !== undefined && scope.provider.length > 0) parts.push(`поставщик: ${scope.provider}`)
  if (scope.region !== undefined && scope.region.length > 0) parts.push(`площадка: ${scope.region}`)
  if (scope.product !== undefined && scope.product.length > 0) parts.push(`продукт: ${scope.product}`)
  return parts.length === 0 ? ['все запуски'] : parts
}

export default function AdminSecurity(): JSX.Element {
  const toast = useToast()

  const [rows, setRows] = createSignal<KillRequestRow[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [actionError, setActionError] = createSignal<string | null>(null)
  const [busyId, setBusyId] = createSignal<string | null>(null)
  const [showHistory, setShowHistory] = createSignal(false)

  const [providerDraft, setProviderDraft] = createSignal('')
  const [reasonDraft, setReasonDraft] = createSignal('')
  const [requestBusy, setRequestBusy] = createSignal(false)
  const [requestError, setRequestError] = createSignal<string | null>(null)

  const [cancelTarget, setCancelTarget] = createSignal<KillRequestRow | null>(null)
  const [cancelBusy, setCancelBusy] = createSignal(false)
  const [cancelError, setCancelError] = createSignal<string | null>(null)

  const [auditRows, setAuditRows] = createSignal<AuditEntry[]>([])
  const [auditLoading, setAuditLoading] = createSignal(true)
  const [auditError, setAuditError] = createSignal<string | null>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.admin.killList()
      setRows(Array.isArray(response.data) ? response.data : [])
    } catch (err) {
      setError(handleAdminError(err))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const loadAudit = async (): Promise<void> => {
    setAuditLoading(true)
    setAuditError(null)
    try {
      const [sets, approvals] = await Promise.all([
        api.admin.audit({ limit: 50, action: 'killswitch.set' }),
        api.admin.audit({ limit: 50, action: 'killswitch.approve' }),
      ])
      const merged = [...(sets.data ?? []), ...(approvals.data ?? [])]
      merged.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      setAuditRows(merged)
    } catch (err) {
      setAuditError(handleAdminError(err))
      setAuditRows([])
    } finally {
      setAuditLoading(false)
    }
  }

  createEffect(
    on(adminRefreshTick, () => {
      void load()
      void loadAudit()
    }),
  )

  const requestKill = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault()
    if (requestBusy()) return
    const reason = reasonDraft().trim()
    if (reason.length === 0) {
      setRequestError('Напишите причину: без неё запрос не создастся.')
      return
    }
    setRequestBusy(true)
    setRequestError(null)
    try {
      const provider = providerDraft()
      const created = await api.admin.killRequest(
        provider.length === 0 ? {} : { provider },
        true,
        reason,
      )
      toast.success(`Запрос создан: ${killStateInfo(created.state).label}`)
      setReasonDraft('')
      await Promise.all([load(), loadAudit()])
    } catch (err) {
      setRequestError(handleAdminError(err))
    } finally {
      setRequestBusy(false)
    }
  }

  const approve = async (row: KillRequestRow): Promise<void> => {
    if (busyId() !== null) return
    setBusyId(row.id)
    setActionError(null)
    try {
      const updated = await api.admin.killApprove(row.id)
      setRows((list) => list.map((entry) => (entry.id === updated.id ? updated : entry)))
      toast.success(`Блокировка: ${killStateInfo(updated.state).label}`)
      await Promise.all([load(), loadAudit()])
    } catch (err) {
      setActionError(handleAdminError(err))
    } finally {
      setBusyId(null)
    }
  }

  const submitCancel = async (reason: string): Promise<void> => {
    const target = cancelTarget()
    if (target === null) return
    setCancelBusy(true)
    setCancelError(null)
    try {
      const updated = await api.admin.killCancel(target.id, reason)
      setRows((list) => list.map((entry) => (entry.id === updated.id ? updated : entry)))
      toast.success('Блокировка снята')
      setCancelTarget(null)
      await Promise.all([load(), loadAudit()])
    } catch (err) {
      setCancelError(handleAdminError(err))
    } finally {
      setCancelBusy(false)
    }
  }

  const activeCount = createMemo(() => rows().filter((row) => row.state === 'active').length)
  const pendingCount = createMemo(() => rows().filter((row) => row.state === 'pending').length)
  const visible = createMemo(() => (showHistory() ? rows() : rows().filter((row) => row.state !== 'disabled')))

  const columns: TableColumn<KillRequestRow>[] = [
    {
      key: 'scope',
      label: 'Область',
      render: (row) => (
        <span class="security-scope">
          {scopeParts(row.scope).map((part) => (
            <span>{part}</span>
          ))}
        </span>
      ),
    },
    {
      key: 'state',
      label: 'Состояние',
      render: (row) => (
        <Badge tone={killStateInfo(row.state).tone} dot>
          {killStateInfo(row.state).label}
        </Badge>
      ),
    },
    { key: 'reason', label: 'Причина', render: (row) => <span class="security-reason">{row.reason}</span> },
    {
      key: 'by',
      label: 'Кто',
      render: (row) => (
        <span class="security-who">
          <span>запросил: {row.by}</span>
          <Show when={row.approved_by !== null && row.approved_by !== undefined}>
            <span class="security-small">подтвердил: {row.approved_by}</span>
          </Show>
        </span>
      ),
    },
    {
      key: 'at',
      label: 'Создано',
      render: (row) => <span class="security-small security-when">{formatDate(row.at)}</span>,
    },
    {
      key: 'actions',
      label: 'Действие',
      render: (row) => (
        <span class="security-actions">
          <Show when={row.state === 'pending'}>
            <Button
              size="sm"
              variant="secondary"
              loading={busyId() === row.id}
              disabled={busyId() !== null && busyId() !== row.id}
              onClick={() => void approve(row)}
            >
              Подтвердить
            </Button>
          </Show>
          <Show when={row.state !== 'disabled'}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCancelError(null)
                setCancelTarget(row)
              }}
              disabled={busyId() !== null}
            >
              Снять
            </Button>
          </Show>
          <Show when={row.state === 'disabled'}>
            <span class="muted security-small">снят</span>
          </Show>
        </span>
      ),
    },
  ]

  const auditColumns: TableColumn<AuditEntry>[] = [
    { key: 'at', label: 'Время', render: (entry) => <span class="security-small security-when">{formatDate(entry.at)}</span> },
    {
      key: 'action',
      label: 'Действие',
      render: (entry) => (
        <span class="security-action">
          <span>{auditActionLabel(entry.action)}</span>
          <span class="security-code">{entry.action}</span>
        </span>
      ),
    },
    { key: 'reason', label: 'Причина', render: (entry) => <span class="security-reason">{entry.reason}</span> },
    {
      key: 'actor_id',
      label: 'Автор',
      render: (entry) => <span class="security-small">{entry.actor_id}</span>,
    },
    {
      key: 'target_id',
      label: 'Запрос',
      render: (entry) => (
        <span class="mono security-small" title={entry.target_id}>
          {shortId(entry.target_id, 12)}
        </span>
      ),
    },
  ]

  return (
    <section class="page security-page">
      <PageHeader
        eyebrow="Безопасность"
        title="Рубильник"
        description="Останавливает новые запуски машин в выбранной области. Запрос начинает действовать после подтверждения вторым дежурным; снятие требует причины. Каждое действие попадает в журнал."
        actions={
          <Button
            variant="secondary"
            loading={loading()}
            onClick={() => {
              void load()
              void loadAudit()
            }}
          >
            Обновить
          </Button>
        }
      />

      <div class="security-stats">
        <Stat
          label="Действующие блокировки"
          value={String(activeCount())}
          tone={activeCount() > 0 ? 'danger' : 'neutral'}
          icon="stop"
          hint={activeCount() > 0 ? 'новые запуски остановлены в своей области' : 'новые запуски не ограничены'}
        />
        <Stat
          label="Ждут подтверждения"
          value={String(pendingCount())}
          tone={pendingCount() > 0 ? 'warning' : 'neutral'}
          icon="shield"
          hint="пока не действуют"
        />
      </div>

      <Card title="Что делает рубильник" class="security-explain">
        <ul class="security-list">
          <li>
            Блокировка останавливает <strong>новые запуски машин</strong>, которые попадают в её область. Уже работающие
            машины продолжают работу: остановить их можно на странице «Машины».
          </li>
          <li>
            Новый запрос создаётся с состоянием «ждёт подтверждения» и начинает действовать только после кнопки
            «Подтвердить» у этого запроса. Подтверждение — отдельное действие с отдельной записью в журнале; правило сервера
            требует, чтобы подтверждал другой сотрудник.
          </li>
          <li>
            Проверка запуска сейчас смотрит на поставщика и продукт запуска машин. Площадка в проверке не участвует,
            поэтому в форме её нет: запись по одной площадке ничего бы не остановила.
          </li>
          <li>Снятие блокировки требует причины и тоже записывается в журнал действий.</li>
        </ul>
      </Card>

      <Card
        title="Запросить блокировку"
        subtitle="Выберите поставщика или оставьте «любой»: тогда блокируются все новые запуски."
      >
        <form class="security-form" aria-label="Запрос блокировки" onSubmit={(event) => void requestKill(event)}>
          <div class="security-form-row">
            <Field label="Поставщик" for="security-provider">
              <Select
                id="security-provider"
                class="select"
                placeholder="любой"
                options={PROVIDERS}
                value={providerDraft()}
                onChange={(event) => setProviderDraft(event.currentTarget.value)}
              />
            </Field>
            <Field
              label="Причина"
              for="security-reason"
              required
              error={requestError()}
              hint="Например: авария у поставщика или указание из обращения."
            >
              <Textarea
                id="security-reason"
                rows={2}
                value={reasonDraft()}
                placeholder="Почему останавливаем новые запуски"
                aria-required="true"
                onInput={(event) => setReasonDraft(event.currentTarget.value)}
              />
            </Field>
          </div>
          <div class="security-form-actions">
            <Button type="submit" variant="primary" loading={requestBusy()}>
              Отправить запрос
            </Button>
          </div>
        </form>
      </Card>

      <AdminError text={error()} onRetry={() => void load()} />

      <AdminError text={actionError()} />

      <Card
        title="Блокировки"
        subtitle="Действующие и ожидающие подтверждения. Снятые записи можно показать переключателем."
        actions={
          <Switch
            checked={showHistory()}
            onChange={setShowHistory}
            label="Показывать снятые"
          />
        }
        flush
      >
        <Show
          when={visible().length > 0 || loading()}
          fallback={
            <EmptyState
              icon="shield"
              title="Активных блокировок нет"
              description="Новые запуски идут обычным порядком. Запрос выше создаёт блокировку, которая начнёт действовать после подтверждения."
            />
          }
        >
          <Table label="Блокировки запусков" columns={columns} rows={visible()} loading={loading()} />
        </Show>
      </Card>

      <AdminError text={auditError()} onRetry={() => void loadAudit()} />

      <Card
        title="Журнал рубильника"
        subtitle="Последние действия с блокировками из общего журнала: запрос, подтверждение, снятие."
        flush
      >
        <Show
          when={auditRows().length > 0 || auditLoading()}
          fallback={
            <EmptyState
              icon="log"
              title="Записей пока нет"
              description="Здесь появятся запросы на блокировку, подтверждения и снятия вместе с причиной и автором."
            />
          }
        >
          <Table
            label="Журнал действий рубильника"
            columns={auditColumns}
            rows={auditRows()}
            loading={auditLoading()}
          />
        </Show>
      </Card>

      <ReasonDialog
        open={cancelTarget() !== null}
        title="Снять блокировку"
        subtitle="Новые запуски в этой области снова станут обычными."
        label="Почему снимаем"
        placeholder="например: поставщик восстановился, тикет закрыт"
        hint="Причина сохранится в журнале действий."
        confirmLabel="Снять блокировку"
        busy={cancelBusy()}
        error={cancelError()}
        onSubmit={(reason) => void submitCancel(reason)}
        onClose={() => {
          if (cancelBusy()) return
          setCancelTarget(null)
          setCancelError(null)
        }}
      />
    </section>
  )
}

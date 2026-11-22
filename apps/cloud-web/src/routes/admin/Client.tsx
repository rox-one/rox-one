import { useParams } from '@solidjs/router'
import { Show, createEffect, createSignal, on } from 'solid-js'

import {
  Badge,
  Button,
  Card,
  CodeBlock,
  Dialog,
  EmptyState,
  Field,
  Money,
  PageHeader,
  Skeleton,
  Stat,
  Table,
  useToast,
} from '@/components'
import type { TableColumn } from '@/components'
import { api } from '@/lib/api'
import type {
  AdminKeyRow,
  AdminResource,
  AuditEntry,
  LedgerEntry,
  RotatedKey,
  TenantDetail,
} from '@/lib/api'
import { formatCents, formatDate, shortId } from '@/lib/format'

import { AdminError } from './components/AdminError'
import {
  adminRefreshTick,
  auditActionLabel,
  capText,
  centsToInput,
  handleAdminError,
  keyHint,
  ledgerKindLabel,
  parseCount,
  parseDollars,
  providerLabel,
  sandboxStateLabel,
  sandboxStateTone,
} from './components/adminSession'

import './client.css'

const MAX_CREDIT_CENTS = 10_000_000
const MAX_REASON = 200

const keyColumns: readonly TableColumn<AdminKeyRow>[] = [
  {
    key: 'id',
    label: 'Ключ',
    render: (row) => <span class="mono small client-key">{keyHint(row.prefix, row.last4)}</span>,
  },
  {
    key: 'scopes',
    label: 'Области',
    render: (row) => (
      <span class="small muted client-scopes">{row.scopes?.join(', ') ?? '—'}</span>
    ),
  },
  {
    key: 'created_at',
    label: 'Создан',
    render: (row) => <span class="small">{formatDate(row.created_at)}</span>,
  },
  {
    key: 'state',
    label: 'Состояние',
    render: (row) => (
      <Show
        when={row.revoked_at ?? null}
        fallback={
          <Badge tone="success" dot>
            действует
          </Badge>
        }
      >
        {(revoked) => (
          <span class="client-state">
            <Badge tone="danger">отозван</Badge>
            <span class="tiny muted">{formatDate(revoked())}</span>
          </span>
        )}
      </Show>
    ),
  },
  {
    key: 'last_used_at',
    label: 'Последний запрос',
    render: (row) => <span class="small">{formatDate(row.last_used_at)}</span>,
  },
]

const machineColumns: readonly TableColumn<AdminResource>[] = [
  {
    key: 'id',
    label: 'Машина',
    render: (row) => (
      <span class="client-machine">
        <span class="mono small" title={row.id}>
          {shortId(row.id)}
        </span>
        <span class="tiny muted">
          {providerLabel(row.provider)}
          {row.region === null || row.region === undefined ? '' : ` · ${row.region}`}
        </span>
      </span>
    ),
  },
  {
    key: 'state',
    label: 'Состояние',
    render: (row) => <Badge tone={sandboxStateTone(row.state)}>{sandboxStateLabel(row.state)}</Badge>,
  },
  {
    key: 'cost_cents',
    label: 'Расход',
    align: 'right',
    render: (row) => <Money cents={row.cost_cents} />,
  },
  {
    key: 'created_at',
    label: 'Создана',
    render: (row) => <span class="small">{formatDate(row.created_at)}</span>,
  },
  {
    key: 'expires_at',
    label: 'Истекает',
    render: (row) => <span class="small">{formatDate(row.expires_at)}</span>,
  },
]

const ledgerColumns: readonly TableColumn<LedgerEntry>[] = [
  {
    key: 'at',
    label: 'Когда',
    render: (row) => <span class="small">{formatDate(row.at)}</span>,
  },
  { key: 'kind', label: 'Вид', render: (row) => <span class="small">{ledgerKindLabel(row.kind)}</span> },
  {
    key: 'amount_cents',
    label: 'Сумма',
    align: 'right',
    render: (row) => (
      <span class="client-amount">
        <Money cents={row.amount_cents} />
        <Show when={(row.shortfall_cents ?? 0) > 0}>
          <span class="tiny muted">недобор {formatCents(row.shortfall_cents ?? 0)}</span>
        </Show>
      </span>
    ),
  },
  {
    key: 'balance_after_cents',
    label: 'Остаток',
    align: 'right',
    render: (row) => <Money cents={row.balance_after_cents} />,
  },
  {
    key: 'reserved_after_cents',
    label: 'В резерве',
    align: 'right',
    render: (row) => <Money cents={row.reserved_after_cents} />,
  },
  {
    key: 'ref',
    label: 'Основание',
    render: (row) => (
      <span class="mono tiny" title={row.ref}>
        {shortId(row.ref)}
      </span>
    ),
  },
]

const auditColumns: readonly TableColumn<AuditEntry>[] = [
  {
    key: 'at',
    label: 'Когда',
    render: (row) => <span class="small">{formatDate(row.at)}</span>,
  },
  {
    key: 'action',
    label: 'Действие',
    render: (row) => <span class="strong">{auditActionLabel(row.action)}</span>,
  },
  {
    key: 'actor_id',
    label: 'Кто',
    render: (row) => <span class="mono small">{row.actor_id}</span>,
  },
  {
    key: 'reason',
    label: 'Причина',
    render: (row) => <span class="client-reason">{row.reason}</span>,
  },
]

export default function AdminClient() {
  const params = useParams<{ id: string }>()
  const toast = useToast()

  const [detail, setDetail] = createSignal<TenantDetail | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  const [creditOpen, setCreditOpen] = createSignal(false)
  const [creditAmount, setCreditAmount] = createSignal('')
  const [creditReason, setCreditReason] = createSignal('')
  const [creditError, setCreditError] = createSignal<string | null>(null)
  const [creditBusy, setCreditBusy] = createSignal(false)

  const [rotateOpen, setRotateOpen] = createSignal(false)
  const [rotateReason, setRotateReason] = createSignal('')
  const [rotateError, setRotateError] = createSignal<string | null>(null)
  const [rotateBusy, setRotateBusy] = createSignal(false)
  const [rotated, setRotated] = createSignal<RotatedKey | null>(null)

  const [limitOpen, setLimitOpen] = createSignal(false)
  const [limitConcurrent, setLimitConcurrent] = createSignal('0')
  const [limitCpu, setLimitCpu] = createSignal('0')
  const [limitCap, setLimitCap] = createSignal('0,00')
  const [limitReason, setLimitReason] = createSignal('')
  const [limitError, setLimitError] = createSignal<string | null>(null)
  const [limitBusy, setLimitBusy] = createSignal(false)
  let generation = 0

  async function load(): Promise<void> {
    const current = ++generation
    const id = params.id
    if (typeof id !== 'string' || id.length === 0) {
      setLoading(false)
      setError('В адресе нет идентификатора клиента.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const value = await api.admin.tenant(id)
      if (current !== generation) return
      setDetail(value)
    } catch (failure) {
      if (current !== generation) return
      setDetail(null)
      setError(handleAdminError(failure))
    } finally {
      if (current === generation) setLoading(false)
    }
  }

  createEffect(on(() => `${adminRefreshTick()}:${params.id}`, () => void load()))

  function openCredit(): void {
    setCreditAmount('')
    setCreditReason('')
    setCreditError(null)
    setCreditOpen(true)
  }

  function closeCredit(): void {
    setCreditOpen(false)
    setCreditAmount('')
    setCreditReason('')
    setCreditError(null)
  }

  async function submitCredit(): Promise<void> {
    if (creditBusy()) return
    const cents = parseDollars(creditAmount())
    if (cents === null || cents < 1) {
      setCreditError('Сумма должна быть больше нуля, например 10,50.')
      return
    }
    if (cents > MAX_CREDIT_CENTS) {
      setCreditError('За один раз можно начислить не больше 100 000,00 $.')
      return
    }
    const reason = creditReason().trim()
    if (reason.length === 0) {
      setCreditError('Напишите основание: оно попадёт в журнал.')
      return
    }
    if (reason.length > MAX_REASON) {
      setCreditError(`Основание не длиннее ${MAX_REASON} символов.`)
      return
    }
    setCreditBusy(true)
    setCreditError(null)
    try {
      await api.admin.credit(params.id, cents, reason)
      toast.success(`Начислено ${formatCents(cents)}.`)
      closeCredit()
      await load()
    } catch (failure) {
      setCreditError(handleAdminError(failure))
    } finally {
      setCreditBusy(false)
    }
  }

  function openRotate(): void {
    setRotateReason('')
    setRotateError(null)
    setRotated(null)
    setRotateOpen(true)
  }

  function closeRotate(): void {
    setRotateOpen(false)
    setRotateReason('')
    setRotateError(null)
    setRotated(null)
  }

  async function submitRotate(): Promise<void> {
    if (rotateBusy()) return
    const reason = rotateReason().trim()
    if (reason.length === 0) {
      setRotateError('Напишите причину: она попадёт в журнал.')
      return
    }
    if (reason.length > MAX_REASON) {
      setRotateError(`Причина не длиннее ${MAX_REASON} символов.`)
      return
    }
    setRotateBusy(true)
    setRotateError(null)
    try {
      const result = await api.admin.rotateKey(params.id, reason)
      setRotated(result)
      setRotateReason('')
      toast.success(`Ключ перевыпущен. Отозвано старых: ${result.revoked}.`)
      await load()
    } catch (failure) {
      setRotateError(handleAdminError(failure))
    } finally {
      setRotateBusy(false)
    }
  }

  function openLimits(): void {
    const limits = detail()?.limits
    setLimitConcurrent(String(limits?.max_concurrent_sandboxes ?? 0))
    setLimitCpu(String(limits?.max_cpu_per_sandbox ?? 0))
    setLimitCap(centsToInput(limits?.max_monthly_cents ?? 0))
    setLimitReason('')
    setLimitError(null)
    setLimitOpen(true)
  }

  function closeLimits(): void {
    setLimitOpen(false)
    setLimitReason('')
    setLimitError(null)
  }

  async function submitLimits(): Promise<void> {
    if (limitBusy()) return
    const concurrent = parseCount(limitConcurrent())
    if (concurrent === null) {
      setLimitError('Машин одновременно — целое число от 0.')
      return
    }
    const cpu = parseCount(limitCpu())
    if (cpu === null) {
      setLimitError('Ядер на машину — целое число от 0.')
      return
    }
    const cap = parseDollars(limitCap())
    if (cap === null) {
      setLimitError('Потолок в месяц — сумма в долларах, например 250 или 250,00.')
      return
    }
    const reason = limitReason().trim()
    if (reason.length === 0) {
      setLimitError('Напишите причину: она попадёт в журнал.')
      return
    }
    if (reason.length > MAX_REASON) {
      setLimitError(`Причина не длиннее ${MAX_REASON} символов.`)
      return
    }
    setLimitBusy(true)
    setLimitError(null)
    try {
      await api.admin.limits(params.id, {
        maxConcurrentSandboxes: concurrent,
        maxCpuPerSandbox: cpu,
        monthlyCapCents: cap,
        reason,
      })
      toast.success('Лимиты сохранены.')
      closeLimits()
      await load()
    } catch (failure) {
      setLimitError(handleAdminError(failure))
    } finally {
      setLimitBusy(false)
    }
  }

  return (
    <section class="page client-page">
      <PageHeader
        back={{ href: '/admin/clients', label: 'Все клиенты' }}
        eyebrow={detail()?.tenant.guest === true ? 'Клиент · гость' : 'Клиент'}
        title={detail()?.tenant.name ?? 'Карточка клиента'}
        description={
          <span class="client-meta">
            <span class="mono">{detail()?.tenant.id ?? params.id}</span>
            <Show when={detail()?.tenant.created_at}>
              {(created) => <span>создан {formatDate(created())}</span>}
            </Show>
          </span>
        }
        actions={
          <div class="client-actions">
            <Button
              size="sm"
              variant="primary"
              onClick={openCredit}
              disabled={detail() === null}
            >
              Пополнить
            </Button>
            <Button size="sm" onClick={openRotate} disabled={detail() === null}>
              Перевыпустить ключ
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={openLimits}
              disabled={detail() === null}
            >
              Изменить лимиты
            </Button>
          </div>
        }
      />

      <AdminError text={error()} onRetry={() => void load()} />

      <Show
        when={detail()}
        fallback={
          <Show when={loading()}>
            <div class="client-loading">
              <Skeleton lines={5} />
            </div>
          </Show>
        }
      >
        {(data) => (
          <>
            <div class="client-summary">
              <Stat
                label="Баланс"
                value={<Money cents={data().account.balance_cents} />}
                hint="свободные деньги"
                tone="accent"
              />
              <Stat
                label="Резерв"
                value={<Money cents={data().account.reserved_cents} />}
                hint="удержано под работающие машины"
              />
              <Stat
                label="Расход за месяц"
                value={<Money cents={data().account.month_spent_cents} />}
                hint={`потолок: ${capText(data().limits.max_monthly_cents)}`}
              />
              <Stat
                label="Потолок в месяц"
                value={capText(data().limits.max_monthly_cents)}
                hint="0 — своего ограничения нет"
              />
            </div>

            <Card
              title="Лимиты и тариф"
              subtitle="Сервер проверяет эти значения при каждом запуске машины."
              actions={
                <Button size="sm" variant="secondary" onClick={openLimits}>
                  Изменить
                </Button>
              }
            >
              <dl class="client-limits">
                <div>
                  <dt>Машин одновременно</dt>
                  <dd>
                    {data().limits.max_concurrent_sandboxes === 0
                      ? 'по умолчанию'
                      : data().limits.max_concurrent_sandboxes}
                  </dd>
                </div>
                <div>
                  <dt>Ядер на машину</dt>
                  <dd>
                    {data().limits.max_cpu_per_sandbox === 0
                      ? 'по умолчанию'
                      : data().limits.max_cpu_per_sandbox}
                  </dd>
                </div>
                <div>
                  <dt>Потолок в месяц</dt>
                  <dd>{capText(data().limits.max_monthly_cents)}</dd>
                </div>
                <div>
                  <dt>Оплаченный тариф</dt>
                  <dd>{data().account.paid === true ? 'да' : 'нет'}</dd>
                </div>
              </dl>
            </Card>

            <div class="client-panels">
              <Card
                title="Ключи клиента"
                subtitle="Секрет не хранится: видны только начало и последние четыре символа."
              >
                <Table
                  label="Ключи клиента"
                  columns={keyColumns}
                  rows={data().keys}
                  rowKey={(row) => row.id}
                  empty={
                    <EmptyState
                      icon="key"
                      title="Ключей нет"
                      description="Клиент ещё не получал ключ API."
                    />
                  }
                />
              </Card>

              <Card title="Машины клиента" subtitle="Новые сверху.">
                <Table
                  label="Машины клиента"
                  columns={machineColumns}
                  rows={data().sandboxes}
                  rowKey={(row) => row.id}
                  empty={
                    <EmptyState
                      icon="server"
                      title="Машин нет"
                      description="Клиент ещё ничего не запускал."
                    />
                  }
                />
              </Card>
            </div>

            <Card
              title="Движение денег"
              subtitle="Пополнения, резервы, возвраты и списания. Новые записи сверху."
            >
              <Table
                label="Движение денег клиента"
                columns={ledgerColumns}
                rows={data().ledger}
                rowKey={(row) => row.id}
                empty={
                  <EmptyState
                    icon="chart"
                    title="Движений пока нет"
                    description="Первое пополнение или первая машина появятся здесь."
                  />
                }
              />
            </Card>

            <Card
              title="Журнал по клиенту"
              subtitle="Последние 20 записей, где этот клиент был целью действия."
            >
              <Table
                label="Журнал действий по клиенту"
                columns={auditColumns}
                rows={data().audit.slice(0, 20)}
                rowKey={(row) => row.id}
                empty={
                  <EmptyState
                    icon="log"
                    title="Записей нет"
                    description="Журнал заполнится, когда ключ, баланс или лимиты изменятся."
                  />
                }
              />
            </Card>
          </>
        )}
      </Show>

      <Dialog
        open={creditOpen()}
        onClose={closeCredit}
        title="Пополнить баланс"
        subtitle={detail() === null ? undefined : `Клиент: ${detail()?.tenant.name}`}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={closeCredit}>
              Отмена
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={creditBusy()}
              onClick={() => void submitCredit()}
            >
              Начислить
            </Button>
          </>
        }
      >
        <form
          class="admin-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submitCredit()
          }}
          novalidate
        >
          <AdminError text={creditError()} />
          <Field
            label="Сумма, $"
            for="credit-amount"
            required
            hint="Копейки — через запятую: 10,50. За один раз не больше 100 000,00 $."
          >
            <input
              id="credit-amount"
              class="input"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              placeholder="10,00"
              value={creditAmount()}
              onInput={(event) => {
                setCreditAmount(event.currentTarget.value)
                setCreditError(null)
              }}
            />
          </Field>
          <Field
            label="Основание"
            for="credit-reason"
            required
            hint="Например: предоплата по счёту или номер обращения. Причина обязательна и попадёт в журнал."
          >
            <input
              id="credit-reason"
              class="input"
              type="text"
              autocomplete="off"
              maxlength={MAX_REASON}
              value={creditReason()}
              onInput={(event) => {
                setCreditReason(event.currentTarget.value)
                setCreditError(null)
              }}
            />
          </Field>
        </form>
      </Dialog>

      <Dialog
        open={rotateOpen()}
        onClose={closeRotate}
        closeOnBackdrop={false}
        title="Перевыпустить ключ"
        subtitle={detail() === null ? undefined : `Клиент: ${detail()?.tenant.name}`}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={closeRotate}>
              {rotated() === null ? 'Отмена' : 'Готово'}
            </Button>
            <Show when={rotated() === null}>
              <Button
                size="sm"
                variant="danger"
                loading={rotateBusy()}
                onClick={() => void submitRotate()}
              >
                Перевыпустить
              </Button>
            </Show>
          </>
        }
      >
        <Show
          when={rotated()}
          fallback={
            <form
              class="admin-form"
              onSubmit={(event) => {
                event.preventDefault()
                void submitRotate()
              }}
              novalidate
            >
              <AdminError text={rotateError()} />
              <div class="client-warn">
                <span class="strong">Старый ключ перестанет работать сразу.</span>
                <span>
                  Все запросы со старым ключом получат отказ. Новый секрет покажется один раз — его
                  нужно передать клиенту и не хранить в панели.
                </span>
              </div>
              <Field
                label="Причина"
                for="rotate-reason"
                required
                hint="Например: ключ попал в чужой чат. Причина обязательна и попадёт в журнал."
              >
                <input
                  id="rotate-reason"
                  class="input"
                  type="text"
                  autocomplete="off"
                  maxlength={MAX_REASON}
                  value={rotateReason()}
                  onInput={(event) => {
                    setRotateReason(event.currentTarget.value)
                    setRotateError(null)
                  }}
                />
              </Field>
            </form>
          }
        >
          {(result) => (
            <div class="client-reveal">
              <div class="client-warn" role="alert">
                <span class="strong">Старый ключ уже не работает.</span>
                <span>
                  Новый секрет показывается только сейчас. Скопируйте его и передайте клиенту; после
                  закрытия окна он исчезнет.
                </span>
              </div>
              <Show when={result().key.api_key ?? ''} keyed>
                {(secret) => <CodeBlock class="client-secret" code={secret} label="Новый ключ API" />}
              </Show>
              <Show when={(result().key.api_key ?? '') === ''}>
                <div class="admin-alert" role="alert">
                  Сервер не вернул секрет нового ключа. Старые ключи при этом уже отозваны:
                  перевыпустите ключ ещё раз, если клиенту нужен новый.
                </div>
              </Show>
              <p class="small muted">
                Отозвано старых ключей: {result().revoked}. Публичная часть нового ключа:{' '}
                {keyHint(result().key.prefix, result().key.last4)}.
              </p>
            </div>
          )}
        </Show>
      </Dialog>

      <Dialog
        open={limitOpen()}
        onClose={closeLimits}
        title="Лимиты клиента"
        subtitle={detail() === null ? undefined : `Клиент: ${detail()?.tenant.name}`}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={closeLimits}>
              Отмена
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={limitBusy()}
              onClick={() => void submitLimits()}
            >
              Сохранить
            </Button>
          </>
        }
      >
        <form
          class="admin-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submitLimits()
          }}
          novalidate
        >
          <AdminError text={limitError()} />
          <Field
            label="Машин одновременно"
            for="limit-concurrent"
            required
            hint="0 — как у всех, по умолчанию сервера."
          >
            <input
              id="limit-concurrent"
              class="input"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              value={limitConcurrent()}
              onInput={(event) => {
                setLimitConcurrent(event.currentTarget.value)
                setLimitError(null)
              }}
            />
          </Field>
          <Field
            label="Ядер на машину"
            for="limit-cpu"
            required
            hint="0 — как у всех, по умолчанию сервера."
          >
            <input
              id="limit-cpu"
              class="input"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              value={limitCpu()}
              onInput={(event) => {
                setLimitCpu(event.currentTarget.value)
                setLimitError(null)
              }}
            />
          </Field>
          <Field
            label="Потолок в месяц, $"
            for="limit-cap"
            required
            hint="0 — без своего потолка. Например 250 или 250,00."
          >
            <input
              id="limit-cap"
              class="input"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              value={limitCap()}
              onInput={(event) => {
                setLimitCap(event.currentTarget.value)
                setLimitError(null)
              }}
            />
          </Field>
          <Field
            label="Причина"
            for="limit-reason"
            required
            hint="Например: запрос клиента. Причина обязательна и попадёт в журнал."
          >
            <input
              id="limit-reason"
              class="input"
              type="text"
              autocomplete="off"
              maxlength={MAX_REASON}
              value={limitReason()}
              onInput={(event) => {
                setLimitReason(event.currentTarget.value)
                setLimitError(null)
              }}
            />
          </Field>
        </form>
      </Dialog>
    </section>
  )
}

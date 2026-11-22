import { Show, createMemo, createSignal, onMount } from 'solid-js'
import type { JSX } from 'solid-js'

import { Badge, Button, Card, EmptyState, PageHeader, Stat, Table } from '@/components'
import type { TableColumn } from '@/components'
import { api } from '@/lib/api'
import type { Account, UsageRow } from '@/lib/api'
import { formatCents, formatDate, formatMoney, shortId } from '@/lib/format'

import { downloadCsv, errorText, modeLabel, todayStamp } from './components/console-ui'

import './invoice.css'

function rowText(row: UsageRow, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function rowNumber(row: UsageRow, key: string): number | null {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export default function ConsoleInvoice(): JSX.Element {
  const [rows, setRows] = createSignal<UsageRow[]>([])
  const [account, setAccount] = createSignal<Account | undefined>(undefined)
  const [loading, setLoading] = createSignal(true)
  const [failure, setFailure] = createSignal<string | null>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    setFailure(null)
    try {
      const [usage, wallet] = await Promise.all([api.usage(), api.account()])
      const sorted = [...usage.data].sort(
        (left, right) => (Date.parse(right.at) || 0) - (Date.parse(left.at) || 0),
      )
      setRows(sorted)
      setAccount(wallet)
    } catch (err) {
      setFailure(errorText(err))
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    void load()
  })

  const total = createMemo<number>(() => rows().reduce((sum, row) => sum + row.cents, 0))
  const cap = (): number => account()?.monthly_cap_cents ?? 0

  const columns: readonly TableColumn<UsageRow>[] = [
    {
      key: 'label',
      label: 'Строка',
      render: (row) => (
        <div class="invoice-line">
          <span class="invoice-line-name">
            {rowText(row, 'label') ?? rowText(row, 'product') ?? 'Машина'}
          </span>
          <span class="invoice-line-ref">№ {shortId(row.ref, 10)}</span>
        </div>
      ),
    },
    {
      key: 'snapshot',
      label: 'Снимок',
      render: (row) => <span class="invoice-snapshot">{rowText(row, 'snapshot') ?? '—'}</span>,
    },
    {
      key: 'billing_mode',
      label: 'Оплата',
      render: (row) => {
        const mode = rowText(row, 'billing_mode')
        return (
          <Badge tone={mode === 'byok' ? 'success' : 'accent'}>{modeLabel(mode)}</Badge>
        )
      },
    },
    {
      key: 'rate',
      label: 'Ставка',
      align: 'right',
      render: (row) => formatMoney(rowNumber(row, 'rate_cents_per_hour'), { perHour: true }),
    },
    {
      key: 'cents',
      label: 'Сумма',
      align: 'right',
      render: (row) => formatCents(row.cents),
    },
    {
      key: 'started',
      label: 'Начало',
      render: (row) => formatDate(rowText(row, 'started_at') ?? rowText(row, 'created_at')),
    },
    {
      key: 'stopped',
      label: 'Остановка',
      render: (row) => {
        const stopped = rowText(row, 'stopped_at')
        return stopped === null ? <span class="muted">ещё идёт</span> : formatDate(stopped)
      },
    },
  ]

  const exportCsv = (): void => {
    downloadCsv(
      `rox-invoice-${todayStamp()}.csv`,
      [
        'Строка',
        'Номер',
        'Снимок',
        'Оплата',
        'Ставка, центов в час',
        'Сумма, центов',
        'Создана',
        'Начало',
        'Остановка',
      ],
      rows().map((row) => [
        rowText(row, 'label') ?? rowText(row, 'product') ?? 'Машина',
        row.ref,
        rowText(row, 'snapshot'),
        modeLabel(rowText(row, 'billing_mode')),
        rowNumber(row, 'rate_cents_per_hour'),
        row.cents,
        rowText(row, 'created_at'),
        rowText(row, 'started_at'),
        rowText(row, 'stopped_at'),
      ]),
    )
  }

  return (
    <section class="page invoice-page">
      <PageHeader
        eyebrow="Кабинет"
        title="Счёт"
        description="Каждая строка хранит состав машины, режим оплаты и ставку. Удаление машины строку не стирает."
        actions={
          <Button
            size="sm"
            variant="secondary"
            disabled={loading() || rows().length === 0}
            onClick={exportCsv}
          >
            Скачать CSV
          </Button>
        }
      />

      <Show when={failure()}>
        {(message) => (
          <div class="console-alert" role="alert">
            <span>Счёт не загрузился: {message()}</span>
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Повторить
            </Button>
          </div>
        )}
      </Show>

      <div class="invoice-stats">
        <Stat
          label="Баланс"
          value={formatCents(account()?.balance_cents)}
          hint="доступно сейчас"
        />
        <Stat
          label="В резерве"
          value={formatCents(account()?.reserved_cents)}
          hint="удержано за живые машины"
        />
        <Stat
          label="За месяц"
          value={formatCents(account()?.month_spent_cents)}
          hint={cap() > 0 ? `потолок ${formatCents(cap())}` : 'без потолка'}
        />
        <Stat
          label="В этом счёте"
          value={formatCents(total())}
          hint={rows().length === 0 ? 'пока пусто' : `${rows().length} строк`}
        />
      </div>

      <Show when={failure() === null || rows().length > 0}>
        <Card
          title="Списания"
          subtitle="Сумма обновляется при остановке машины, строка остаётся после удаления"
          class="invoice-card"
          flush
        >
          <Table
            columns={columns}
            rows={rows()}
            rowKey={(row) => row.ref}
            label="Списания кабинета"
            loading={loading()}
            empty={
              <EmptyState
                icon="chart"
                title="Списаний пока нет"
                description="Строка появляется в момент запуска машины и закрывается при остановке: состав, режим и ставка остаются в ней навсегда."
              />
            }
          />
          <Show when={rows().length > 0}>
            <div class="invoice-total">
              <span>Итого по счёту</span>
              <strong>{formatCents(total())}</strong>
            </div>
          </Show>
        </Card>
      </Show>

      <p class="field-hint">
        CSV в UTF-8 с меткой BOM: русские названия открываются в Excel без искажений, разделитель —
        запятая.
      </p>
    </section>
  )
}

import { Show, createMemo, createSignal, onMount } from 'solid-js'
import type { JSX } from 'solid-js'

import { Button, Card, EmptyState, Field, PageHeader, Select, Table } from '@/components'
import type { TableColumn } from '@/components'
import { api } from '@/lib/api'
import type { AuditEntry } from '@/lib/api'
import { formatDate, shortId } from '@/lib/format'

import { auditLabel, downloadCsv, errorText, todayStamp } from './components/console-ui'

import './journal.css'

const LIMIT = 200

const OBJECT_KINDS: Record<string, string> = {
  sandbox: 'машина',
  tenant: 'клиент',
  credit: 'счёт',
  account: 'счёт',
  key: 'ключ',
  api_key: 'ключ',
  ticket: 'обращение',
  incident: 'происшествие',
}

function objectLabel(entry: AuditEntry): string {
  const kind = OBJECT_KINDS[entry.target_type] ?? entry.target_type
  return `${kind} · ${shortId(entry.target_id, 10)}`
}

export default function ConsoleJournal(): JSX.Element {
  const [rows, setRows] = createSignal<AuditEntry[]>([])
  const [loading, setLoading] = createSignal(true)
  const [failure, setFailure] = createSignal<string | null>(null)
  const [action, setAction] = createSignal('')

  const load = async (): Promise<void> => {
    setLoading(true)
    setFailure(null)
    try {
      const listing = await api.audit({ limit: LIMIT })
      setRows(listing.data)
    } catch (err) {
      setFailure(errorText(err))
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    void load()
  })

  const actionOptions = createMemo(() => {
    const seen = new Set<string>()
    for (const row of rows()) seen.add(row.action)
    return [
      { value: '', label: 'Все действия' },
      ...[...seen].sort().map((code) => ({ value: code, label: auditLabel(code) })),
    ]
  })

  const visible = createMemo<AuditEntry[]>(() => {
    const filter = action()
    if (filter.length === 0) return rows()
    return rows().filter((row) => row.action === filter)
  })

  const columns: readonly TableColumn<AuditEntry>[] = [
    {
      key: 'at',
      label: 'Когда',
      render: (row) => formatDate(row.at),
    },
    {
      key: 'action',
      label: 'Действие',
      render: (row) => (
        <div class="journal-action">
          <span>{auditLabel(row.action)}</span>
          <span class="journal-code">{row.action}</span>
        </div>
      ),
    },
    {
      key: 'target',
      label: 'Объект',
      render: (row) => <span class="journal-target">{objectLabel(row)}</span>,
    },
    {
      key: 'reason',
      label: 'Причина',
      render: (row) => (row.reason.length > 0 ? row.reason : '—'),
    },
  ]

  const exportCsv = (): void => {
    downloadCsv(
      `rox-journal-${todayStamp()}.csv`,
      ['Когда', 'Действие', 'Код', 'Объект', 'Вид', 'Номер', 'Причина'],
      visible().map((row) => [
        formatDate(row.at),
        auditLabel(row.action),
        row.action,
        objectLabel(row),
        row.target_type,
        row.target_id,
        row.reason,
      ]),
    )
  }

  return (
    <section class="page journal-page">
      <PageHeader
        eyebrow="Кабинет"
        title="Журнал"
        description="Что происходило с вашими машинами и счётом: запуски, остановки, удаления. Записи не удаляются вместе с машиной."
        actions={
          <>
            <Button size="sm" variant="secondary" loading={loading()} onClick={() => void load()}>
              Обновить
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={loading() || visible().length === 0}
              onClick={exportCsv}
            >
              Скачать CSV
            </Button>
          </>
        }
      />

      <Show when={failure()}>
        {(message) => (
          <div class="console-alert" role="alert">
            <span>Журнал не загрузился: {message()}</span>
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Повторить
            </Button>
          </div>
        )}
      </Show>

      <div class="journal-filter">
        <Field label="Действие" for="journal-action" hint="Фильтр по коду действия">
          <Select
            id="journal-action"
            options={actionOptions()}
            value={action()}
            onChange={(event) => setAction(event.currentTarget.value)}
          />
        </Field>
        <Show when={action().length > 0}>
          <Button size="sm" variant="ghost" onClick={() => setAction('')}>
            Сбросить фильтр
          </Button>
        </Show>
      </div>

      <Show when={failure() === null || rows().length > 0}>
        <Card
          title="События"
          subtitle={`Последние ${LIMIT} записей; старые остаются в хранилище`}
          flush
        >
          <Table
            columns={columns}
            rows={visible()}
            rowKey={(row) => row.id}
            label="Журнал действий кабинета"
            loading={loading()}
            empty={
              <EmptyState
                icon="log"
                title={action().length > 0 ? 'По этому действию записей нет' : 'Журнал пока пуст'}
                description={
                  action().length > 0
                    ? 'Сбросьте фильтр или выберите другое действие.'
                    : 'Здесь появятся запуски, остановки и удаления машин, а также обращения и изменения счёта.'
                }
              />
            }
          />
        </Card>
      </Show>

      <p class="field-hint">
        Журнал пишет сервер: строки не редактируются и не стираются из кабинета. В CSV попадают только
        показанные строки — с учётом фильтра.
      </p>
    </section>
  )
}

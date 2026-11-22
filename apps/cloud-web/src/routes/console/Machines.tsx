import { A, useNavigate } from '@solidjs/router'
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import type { JSX } from 'solid-js'

import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Icon,
  PageHeader,
  Select,
  Skeleton,
  Table,
  Tabs,
  useToast,
} from '@/components'
import type { SelectOption, TableColumn } from '@/components'
import { api } from '@/lib/api'
import type { Sandbox } from '@/lib/api'
import { formatCents, formatDate, formatMoney, shortId } from '@/lib/format'
import { animateNumber, flip } from '@/lib/motion'

import { useConsoleSession } from './components/console-session'
import {
  errorText,
  machineDisplayName,
  modeLabel,
  regionFlag,
  regionLabel,
  sizeLine,
  stateLabel,
  stateTone,
  ttlLabel,
} from './components/console-ui'

import './machines.css'

/** A machine that has no personal name yet: a Rox name built from its size. */
function snapshotName(sandbox: Sandbox): string {
  return machineDisplayName(sandbox.spec)
}

/** The person's own name for the machine, or the name its image gives it. */
function machineName(sandbox: Sandbox): string {
  const custom = sandbox.display_name
  if (typeof custom === 'string' && custom.trim().length > 0) return custom.trim()
  return snapshotName(sandbox)
}

function sandboxRegion(sandbox: Sandbox): string {
  const fromSpec = sandbox.spec?.region
  if (typeof fromSpec === 'string' && fromSpec.length > 0) return fromSpec
  const top = sandbox['region']
  return typeof top === 'string' ? top : ''
}

const STOPPABLE: readonly string[] = ['queued', 'starting', 'running', 'paused']
const BILLABLE: readonly string[] = ['queued', 'starting', 'running', 'paused', 'stopping']

/** A stopped machine is not billed, so its price is never shown as running. */
function rateText(sandbox: Sandbox): string {
  if (!BILLABLE.includes(sandbox.state)) return 'счёт закрыт'
  return formatMoney(sandbox.billing?.rate_cents_per_hour, { perHour: true })
}

/** The life of the machine: its TTL, or the span from creation to expiry. */
function lifetimeLabel(sandbox: Sandbox): string {
  const ttl = sandbox.spec?.ttlSec
  if (typeof ttl === 'number' && ttl > 0) return ttlLabel(ttl)
  if (typeof sandbox.expires_at === 'string' && sandbox.expires_at.length > 0) {
    const start = Date.parse(sandbox.created_at)
    const end = Date.parse(sandbox.expires_at)
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return ttlLabel(Math.round((end - start) / 1000))
    }
  }
  return 'без ограничения'
}

function expiryTitle(sandbox: Sandbox): string {
  return typeof sandbox.expires_at === 'string' && sandbox.expires_at.length > 0
    ? `до ${formatDate(sandbox.expires_at)}`
    : 'без ограничения по времени'
}

const STATUS_FILTER = 'Все статусы'
const LOCATION_FILTER = 'Все площадки'

const GROUP_OPTIONS: readonly SelectOption[] = [
  { value: '', label: 'Без группировки' },
  { value: 'status', label: 'По статусу' },
  { value: 'location', label: 'По площадке' },
  { value: 'size', label: 'По размеру' },
]

type GroupKey = '' | 'status' | 'location' | 'size'

const VIEW_ITEMS = [
  { id: 'cards', label: 'Карточки' },
  { id: 'table', label: 'Таблица' },
]

interface PendingAction {
  kind: 'stop' | 'delete'
  sandbox: Sandbox
}

interface Group {
  key: string
  label: string
  rows: Sandbox[]
}

export default function ConsoleMachines(): JSX.Element {
  const session = useConsoleSession()
  const toast = useToast()
  const navigate = useNavigate()

  const [rows, setRows] = createSignal<Sandbox[]>([])
  const [loading, setLoading] = createSignal(true)
  const [failure, setFailure] = createSignal<string | null>(null)
  const [pending, setPending] = createSignal<PendingAction | null>(null)
  const [acting, setActing] = createSignal<string | null>(null)
  const [actionError, setActionError] = createSignal<string | null>(null)

  // The first answer builds the page; a later refresh only updates it, so the
  // count, the toolbar and the cards stay where they are while the request flies.
  const firstLoad = createMemo<boolean>(() => loading() && rows().length === 0)

  // The results area stays put across a refresh; Motion measures the cards
  // inside it, so a re-sort or a deleted machine moves its neighbours.
  let listHost: HTMLDivElement | undefined

  // The total counts up instead of jumping; the label around it never moves.
  let shownTotal = 0
  let stopTotal: (() => void) | undefined
  const [totalText, setTotalText] = createSignal(0)
  createEffect(() => {
    const total = rows().length
    const from = shownTotal
    shownTotal = total
    stopTotal?.()
    stopTotal = animateNumber(from, total, {
      onUpdate: (value) => setTotalText(Math.round(value)),
    }).stop
  })
  onCleanup(() => stopTotal?.())

  const [view, setView] = createSignal<'cards' | 'table'>('cards')
  const [query, setQuery] = createSignal('')
  const [stateFilter, setStateFilter] = createSignal('')
  const [locationFilter, setLocationFilter] = createSignal('')
  const [group, setGroup] = createSignal<GroupKey>('')

  /**
   * Swap the list in place. Motion measures the cards before the change, so a
   * re-sort slides them into their new order and a new card fades in. The table
   * has no cards to match, so it updates as before.
   */
  const applyRows = (next: Sandbox[]): void => {
    const host = listHost
    if (host === undefined || !host.isConnected || view() !== 'cards') {
      setRows(next)
      return
    }
    flip(host, () => setRows(next))
  }

  const [renameTarget, setRenameTarget] = createSignal<Sandbox | null>(null)
  const [renameValue, setRenameValue] = createSignal('')
  const [renameSaving, setRenameSaving] = createSignal(false)
  const [renameError, setRenameError] = createSignal<string | null>(null)

  const ask = (action: PendingAction): void => {
    setActionError(null)
    setPending(action)
  }

  const closeDialog = (): void => {
    setPending(null)
    setActionError(null)
  }

  const load = async (): Promise<void> => {
    setLoading(true)
    setFailure(null)
    try {
      const listing = await api.sandboxes()
      const sorted = [...listing.data].sort(
        (left, right) =>
          (Date.parse(right.created_at) || 0) - (Date.parse(left.created_at) || 0),
      )
      applyRows(sorted)
    } catch (err) {
      setFailure(errorText(err))
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    void load()
  })

  const working = createMemo<number>(
    () => rows().filter((sandbox) => STOPPABLE.includes(sandbox.state)).length,
  )

  const statusOptions = createMemo<SelectOption[]>(() => {
    const seen = new Map<string, string>()
    for (const sandbox of rows()) seen.set(sandbox.state, stateLabel(sandbox.state))
    return [
      { value: '', label: STATUS_FILTER },
      ...[...seen].map(([value, label]) => ({ value, label })),
    ]
  })

  const locationOptions = createMemo<SelectOption[]>(() => {
    const seen = new Map<string, string>()
    for (const sandbox of rows()) {
      const id = sandboxRegion(sandbox)
      seen.set(id, `${regionFlag(id)} ${regionLabel(id)}`)
    }
    return [
      { value: '', label: LOCATION_FILTER },
      ...[...seen].map(([value, label]) => ({ value, label })),
    ]
  })

  // A reload can drop the last machine in a chosen status or site; keeping the
  // stale value would show an empty list under a filter the control no longer
  // displays, so the filter falls back to «all».
  createEffect(() => {
    const states = statusOptions().map((option) => option.value)
    if (stateFilter() !== '' && !states.includes(stateFilter())) setStateFilter('')
    const locations = locationOptions().map((option) => option.value)
    if (locationFilter() !== '' && !locations.includes(locationFilter())) setLocationFilter('')
  })

  const filtered = createMemo<Sandbox[]>(() => {
    const needle = query().trim().toLowerCase()
    const state = stateFilter()
    const location = locationFilter()
    return rows().filter((sandbox) => {
      if (state !== '' && sandbox.state !== state) return false
      if (location !== '' && sandboxRegion(sandbox) !== location) return false
      if (needle === '') return true
      const haystack = [
        machineName(sandbox),
        snapshotName(sandbox),
        sandbox.id,
        sandboxRegion(sandbox),
        regionLabel(sandboxRegion(sandbox)),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  })

  const filtering = createMemo<boolean>(
    () => query().trim() !== '' || stateFilter() !== '' || locationFilter() !== '',
  )

  const groups = createMemo<Group[]>(() => {
    const list = filtered()
    const mode = group()
    if (mode === '') return [{ key: 'all', label: '', rows: list }]
    const label = (sandbox: Sandbox): string => {
      if (mode === 'status') return stateLabel(sandbox.state)
      if (mode === 'location') return `${regionFlag(sandboxRegion(sandbox))} ${regionLabel(sandboxRegion(sandbox))}`
      return sizeLine(sandbox.spec ?? {})
    }
    const buckets = new Map<string, Group>()
    for (const sandbox of list) {
      const key = label(sandbox)
      const bucket = buckets.get(key)
      if (bucket === undefined) buckets.set(key, { key, label: key, rows: [sandbox] })
      else bucket.rows.push(sandbox)
    }
    return [...buckets.values()]
  })

  const resetFilters = (): void => {
    setQuery('')
    setStateFilter('')
    setLocationFilter('')
    setGroup('')
  }

  const busy = (sandbox: Sandbox): boolean => acting() === sandbox.id

  /** What the name falls back to when the person clears their own. */
  const renameFallback = createMemo<string>(() => {
    const target = renameTarget()
    return target === null ? '' : snapshotName(target)
  })

  const openRename = (sandbox: Sandbox): void => {
    const custom = typeof sandbox.display_name === 'string' ? sandbox.display_name.trim() : ''
    setRenameValue(custom)
    setRenameError(null)
    setRenameTarget(sandbox)
  }

  const closeRename = (): void => {
    if (renameSaving()) return
    setRenameTarget(null)
    setRenameError(null)
  }

  const saveName = async (): Promise<void> => {
    const target = renameTarget()
    if (target === null || renameSaving()) return
    const value = renameValue().trim().replace(/\s+/g, ' ')
    setRenameSaving(true)
    setRenameError(null)
    try {
      const updated = await api.updateSandbox(target.id, { displayName: value })
      setRows((current) => current.map((row) => (row.id === updated.id ? updated : row)))
      setRenameTarget(null)
      toast.success(
        value.length > 0
          ? `Машина теперь называется «${value}».`
          : `Своё имя убрано: машина снова называется ${snapshotName(updated)}.`,
      )
    } catch (err) {
      setRenameError(`Не удалось сохранить название: ${errorText(err)}`)
    } finally {
      setRenameSaving(false)
    }
  }

  const confirm = async (): Promise<void> => {
    const task = pending()
    if (task === null) return
    setActing(task.sandbox.id)
    try {
      if (task.kind === 'stop') {
        await api.stopSandbox(task.sandbox.id)
        toast.success('Машина остановлена: плата рассчитана по фактическому времени')
      } else {
        await api.deleteSandbox(task.sandbox.id)
        toast.success('Машина удалена, остаток резерва вернулся на счёт')
      }
      setPending(null)
      await load()
      void session.refreshAccount()
    } catch (err) {
      // The dialog is modal: a toast behind it would be invisible.
      setActionError(errorText(err))
    } finally {
      setActing(null)
    }
  }

  const rowActions = (sandbox: Sandbox): JSX.Element => (
    <div
      class="machines-row-actions"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Button
        size="sm"
        variant="ghost"
        icon={<Icon name="pencil" size={14} />}
        aria-label={`Переименовать машину ${machineName(sandbox)}`}
        title="Переименовать"
        onClick={() => openRename(sandbox)}
      />
      <Button
        size="sm"
        variant="ghost"
        icon={<Icon name="stop" size={14} />}
        aria-label={`Остановить машину ${machineName(sandbox)}`}
        title="Остановить"
        disabled={busy(sandbox) || !STOPPABLE.includes(sandbox.state)}
        loading={busy(sandbox) && pending()?.kind === 'stop'}
        onClick={() => ask({ kind: 'stop', sandbox })}
      />
      <Button
        size="sm"
        variant="ghost"
        icon={<Icon name="trash" size={14} />}
        aria-label={`Удалить машину ${machineName(sandbox)}`}
        title="Удалить"
        disabled={busy(sandbox)}
        loading={busy(sandbox) && pending()?.kind === 'delete'}
        onClick={() => ask({ kind: 'delete', sandbox })}
      />
    </div>
  )

  const columns: TableColumn<Sandbox>[] = [
    {
      key: 'name',
      label: 'Имя',
      render: (sandbox) => (
        <div class="machines-cell-name">
          <A
            href={`/console/machines/${sandbox.id}`}
            class="machines-cell-link"
            onClick={(event) => event.stopPropagation()}
          >
            {machineName(sandbox)}
          </A>
          <span class="machines-cell-ref">{shortId(sandbox.id, 10)}</span>
        </div>
      ),
    },
    {
      key: 'state',
      label: 'Статус',
      render: (sandbox) => (
        <Badge tone={stateTone(sandbox.state)} dot>
          {stateLabel(sandbox.state)}
        </Badge>
      ),
    },
    {
      key: 'location',
      label: 'Площадка',
      render: (sandbox) => {
        const id = sandboxRegion(sandbox)
        return (
          <span class="machines-cell-region">
            <span class="machine-region-flag" aria-hidden="true">
              {regionFlag(id)}
            </span>{' '}
            {regionLabel(id)}
          </span>
        )
      },
    },
    {
      key: 'composition',
      label: 'Состав',
      render: (sandbox) => sizeLine(sandbox.spec ?? {}),
    },
    {
      key: 'price',
      label: 'Цена',
      align: 'right',
      render: (sandbox) => (
        <span classList={{ 'machines-closed': !BILLABLE.includes(sandbox.state) }}>
          {rateText(sandbox)}
        </span>
      ),
    },
    {
      key: 'spent',
      label: 'Списано',
      align: 'right',
      render: (sandbox) => formatCents(sandbox.cost_so_far_cents ?? 0),
    },
    {
      key: 'lifetime',
      label: 'Срок',
      render: (sandbox) => <span title={expiryTitle(sandbox)}>{lifetimeLabel(sandbox)}</span>,
    },
    {
      key: 'actions',
      label: 'Действия',
      align: 'right',
      class: 'machines-actions-cell',
      render: (sandbox) => rowActions(sandbox),
    },
  ]

  const card = (sandbox: Sandbox): JSX.Element => (
    <article class="machine-card" data-flip-key={sandbox.id} aria-labelledby={`machine-${sandbox.id}-name`}>
      <header class="machine-card-head">
        <div class="machine-card-id">
          <h2 class="machine-card-name">
            <A
              href={`/console/machines/${sandbox.id}`}
              class="machine-card-link"
              id={`machine-${sandbox.id}-name`}
              title="Открыть машину: терминал, файлы и просмотр"
            >
              {machineName(sandbox)}
            </A>
          </h2>
          <span class="machine-card-ref">Машина {shortId(sandbox.id, 10)}</span>
        </div>
        <Badge tone={stateTone(sandbox.state)} dot>
          {stateLabel(sandbox.state)}
        </Badge>
      </header>

      <dl class="machine-rows">
        <div>
          <dt>Состав</dt>
          <dd>{sizeLine(sandbox.spec ?? {})}</dd>
        </div>
        <div>
          <dt>Площадка</dt>
          <dd>
            <span class="machine-region-flag" aria-hidden="true">
              {regionFlag(sandboxRegion(sandbox))}
            </span>{' '}
            {regionLabel(sandboxRegion(sandbox))}
          </dd>
        </div>
        <div>
          <dt>Оплата</dt>
          <dd>
            <Badge tone={sandbox.billing?.mode === 'byok' ? 'success' : 'accent'}>
              {modeLabel(sandbox.billing?.mode)}
            </Badge>{' '}
            <span
              class="machine-rate"
              classList={{ 'machines-closed': !BILLABLE.includes(sandbox.state) }}
            >
              {rateText(sandbox)}
            </span>
          </dd>
        </div>
        <div>
          <dt>Списано</dt>
          <dd>{formatCents(sandbox.cost_so_far_cents ?? 0)}</dd>
        </div>
        <div>
          <dt>Срок</dt>
          <dd title={expiryTitle(sandbox)}>{lifetimeLabel(sandbox)}</dd>
        </div>
      </dl>

      <footer class="machine-card-actions">
        <A
          href={`/console/machines/${sandbox.id}`}
          class="btn btn-primary btn-sm"
          aria-label={`Открыть машину ${machineName(sandbox)}: терминал, файлы и просмотр`}
        >
          Открыть
        </A>
        <Button
          size="sm"
          variant="ghost"
          icon={<Icon name="pencil" size={14} />}
          onClick={() => openRename(sandbox)}
        >
          Переименовать
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy(sandbox) || !STOPPABLE.includes(sandbox.state)}
          loading={busy(sandbox) && pending()?.kind === 'stop'}
          onClick={() => ask({ kind: 'stop', sandbox })}
        >
          Остановить
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={busy(sandbox)}
          loading={busy(sandbox) && pending()?.kind === 'delete'}
          onClick={() => ask({ kind: 'delete', sandbox })}
        >
          Удалить
        </Button>
      </footer>
    </article>
  )

  return (
    <section class="page machines-page">
      <PageHeader
        eyebrow="Кабинет"
        title="Машины"
        description="Что запущено, сколько стоит и когда остановится. Терминал открывается в браузере."
        actions={
          <>
            <Button size="sm" variant="secondary" loading={loading()} onClick={() => void load()}>
              Обновить
            </Button>
            <A href="/console" class="btn btn-primary btn-sm">
              Новый продукт
            </A>
          </>
        }
      />

      <Show when={rows().length > 0}>
        <div class="machines-count">
          Всего {totalText()} · активны {working()}
          <Show when={filtering()}>
            {' · '}показано {filtered().length}
          </Show>
        </div>
      </Show>

      <Show when={rows().length > 0}>
        <div class="machines-toolbar">
          <Tabs
            items={VIEW_ITEMS}
            active={view()}
            onChange={(id) => setView(id === 'table' ? 'table' : 'cards')}
            label="Вид списка машин"
            class="machines-views"
          />
          <input
            type="search"
            class="input machines-search"
            value={query()}
            placeholder="Имя, номер или площадка"
            aria-label="Поиск машины по имени, номеру или площадке"
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          <Select
            class="machines-filter"
            options={statusOptions()}
            value={stateFilter()}
            aria-label="Фильтр по статусу"
            onChange={(event) => setStateFilter(event.currentTarget.value)}
          />
          <Select
            class="machines-filter"
            options={locationOptions()}
            value={locationFilter()}
            aria-label="Фильтр по площадке"
            onChange={(event) => setLocationFilter(event.currentTarget.value)}
          />
          <Select
            class="machines-filter"
            options={GROUP_OPTIONS}
            value={group()}
            aria-label="Группировка машин"
            onChange={(event) => setGroup(event.currentTarget.value as GroupKey)}
          />
        </div>
      </Show>

      <Show when={failure()}>
        {(message) => (
          <div class="console-alert" role="alert">
            <span>Список машин не загрузился: {message()}</span>
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Повторить
            </Button>
          </div>
        )}
      </Show>

      <div class="machines-results" ref={listHost} aria-busy={loading() ? 'true' : undefined}>
        <Show
          when={!firstLoad()}
          fallback={
            <div class="machines-grid machines-grid-loading" aria-live="polite">
              <Card>
                <Skeleton lines={4} />
              </Card>
              <Card>
                <Skeleton lines={4} />
              </Card>
              <Card>
                <Skeleton lines={4} />
              </Card>
            </div>
          }
        >
          <Show
            when={rows().length > 0}
            fallback={
              <Show when={failure() === null}>
                <Card>
                  <EmptyState
                    icon="server"
                    title="Машин пока нет"
                    description="Соберите состав на одном экране: пресет, образ, площадка и срок жизни. Запуск занимает минуту."
                    action={
                      <A href="/console" class="btn btn-primary">
                        Выбрать продукт
                      </A>
                    }
                  />
                </Card>
              </Show>
            }
          >
            <Show
              when={filtered().length > 0}
              fallback={
                <Card>
                  <EmptyState
                    icon="server"
                    title="Ничего не нашлось"
                    description="Под поиск и фильтры не попала ни одна машина. Измените условия или сбросьте их."
                    action={
                      <Button variant="secondary" onClick={resetFilters}>
                        Сбросить фильтры
                      </Button>
                    }
                  />
                </Card>
              }
            >
              <For each={groups()}>
                {(section) => (
                  <section
                    class="machines-group"
                    aria-label={section.label === '' ? undefined : section.label}
                  >
                    <Show when={section.label !== ''}>
                      <h2 class="machines-group-head">
                        {section.label}
                        <span class="machines-group-count">{section.rows.length}</span>
                      </h2>
                    </Show>
                    <Show
                      when={view() === 'cards'}
                      fallback={
                        <Table
                          columns={columns}
                          rows={section.rows}
                          rowKey={(row) => row.id}
                          label={section.label === '' ? 'Машины' : `Машины: ${section.label}`}
                          onRowClick={(sandbox) => navigate(`/console/machines/${sandbox.id}`)}
                          empty={<EmptyState title="Пусто" description="Здесь пока нет машин." />}
                        />
                      }
                    >
                      <div class="machines-grid">
                        <For each={section.rows}>{(sandbox) => card(sandbox)}</For>
                      </div>
                    </Show>
                  </section>
                )}
              </For>
            </Show>
          </Show>
        </Show>
      </div>

      <Dialog
        open={pending() !== null}
        onClose={closeDialog}
        title={pending()?.kind === 'delete' ? 'Удалить машину?' : 'Остановить машину?'}
        subtitle={pending() === null ? undefined : `Машина ${shortId(pending()?.sandbox.id, 10)}`}
        footer={
          <>
            <Button variant="ghost" onClick={closeDialog}>
              Отмена
            </Button>
            <Button
              variant={pending()?.kind === 'delete' ? 'danger' : 'primary'}
              loading={acting() !== null}
              onClick={() => void confirm()}
            >
              {pending()?.kind === 'delete' ? 'Удалить' : 'Остановить'}
            </Button>
          </>
        }
      >
        <Show when={actionError()}>
          {(message) => (
            <div class="console-alert" role="alert">
              <span>{message()}</span>
            </div>
          )}
        </Show>
        <Show
          when={pending()?.kind === 'delete'}
          fallback={
            <p class="console-muted">
              Машина остановится, плата рассчитается по фактическому времени работы, неиспользованный
              резерв вернётся на счёт. Строка счёта останется.
            </p>
          }
        >
          <p class="console-muted">
            Машина и её диск пропадут безвозвратно. Остаток резерва вернётся на счёт, а строка счёта
            останется в истории.
          </p>
        </Show>
      </Dialog>

      <Dialog
        open={renameTarget() !== null}
        onClose={closeRename}
        title="Название машины"
        subtitle="Видно только в кабинете: на самой машине ничего не меняется."
        footer={
          <>
            <Button variant="ghost" disabled={renameSaving()} onClick={closeRename}>
              Отмена
            </Button>
            <Button variant="primary" loading={renameSaving()} onClick={() => void saveName()}>
              Сохранить
            </Button>
          </>
        }
      >
        <Show when={renameError()}>
          {(message) => (
            <div class="console-alert" role="alert">
              <span>{message()}</span>
            </div>
          )}
        </Show>
        <Field
          label="Название"
          for="machines-rename-input"
          hint={`Пустое поле вернёт имя по образу: ${renameFallback()}.`}
        >
          <input
            id="machines-rename-input"
            class="input"
            type="text"
            maxlength={64}
            placeholder={renameFallback() || undefined}
            value={renameValue()}
            disabled={renameSaving()}
            onInput={(event) => setRenameValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void saveName()
              }
            }}
          />
        </Field>
      </Dialog>
    </section>
  )
}

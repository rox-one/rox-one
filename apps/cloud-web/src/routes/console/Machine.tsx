import { A, useNavigate, useParams } from '@solidjs/router'
import { Show, createEffect, createSignal, on, onCleanup } from 'solid-js'
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
  Skeleton,
  useToast,
} from '@/components'
import type { BadgeTone } from '@/components'
import { ApiError, api } from '@/lib/api'
import type { Sandbox, SandboxState } from '@/lib/api'
import { formatCents, formatDate, formatMoney, formatTime, shortId } from '@/lib/format'

import { useConsoleSession } from './components/console-session'
import {
  coresLabel,
  errorText,
  gpuName,
  machineDisplayName,
  modeLabel,
  regionFlag,
  regionLabel,
  stateLabel as labelForState,
  stateTone as toneForState,
  ttlLabel,
} from './components/console-ui'

import MachineAccess from './MachineAccess'
import MachineAccessJournal from './MachineAccessJournal'
import MachineMetrics from './MachineMetrics'
import MachineSnapshots from './MachineSnapshots'
import MachineWorkspace from './MachineWorkspace'
import './machine.css'

const POLL_MS = 5000

/** States the server can change on its own: a running machine is polled every
 * 5 s, and so is a boot or a stop that has not settled yet. */
const POLLED_STATES: readonly SandboxState[] = ['queued', 'starting', 'running', 'stopping']

function gigabytes(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value} ГБ` : '—'
}

/** A life span reads `1 ч` or `15 мин`; a missing one is a dash, not zero. */
function ttlText(seconds: number | null | undefined): string {
  return seconds === null || seconds === undefined ? '—' : ttlLabel(seconds)
}

function textOrDash(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : '—'
}

/** Daytona regions in a person's words; the id stays for anything unknown. */
const REGION_TEXT: Record<string, string> = {
  us: 'США, общая',
  'us-west-4': 'США, запад 4, выделенная',
}

function regionText(id: string | null): string {
  if (id === null) return 'выбирает поставщик'
  return REGION_TEXT[id] ?? regionLabel(id)
}

/** The region may sit beside the spec (older records) or inside it. */
function regionOf(machine: Sandbox): string | null {
  const top = machine['region']
  if (typeof top === 'string' && top.length > 0) return top
  const spec = machine.spec?.region
  return typeof spec === 'string' && spec.length > 0 ? spec : null
}

/** The person's own name for the machine, or the name its make-up gives it. */
function machineName(machine: Sandbox): string {
  const custom = machine.display_name
  if (typeof custom === 'string' && custom.trim().length > 0) return custom.trim()
  return machineDisplayName(machine.spec)
}

/** The ribbon keeps the site short: «США», not «США, общая»; the title has the rest. */
function shortRegion(id: string | null): string {
  if (id === 'us' || id === 'us-west-4') return 'США'
  return regionText(id)
}

/**
 * The whole machine in one horizontal ribbon: the image, its resources, the
 * flag of the site, billing, spent money and lifetime. The id stays a button,
 * so copying it does not need a second row.
 */
function MachineRibbon(props: { machine: Sandbox }): JSX.Element {
  const [copied, setCopied] = createSignal(false)

  const copyId = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(props.machine.id)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div class="machine-ribbon" role="group" aria-label="Состав и цена машины">
      <span
        class="ribbon-name"
        title={`${machineName(props.machine)}. Образ ${textOrDash(props.machine.spec?.snapshot ?? props.machine.spec?.image)}; поставщик ${textOrDash(props.machine.provider)}`}
      >
        {machineName(props.machine)}
      </span>
      <span class="ribbon-sep" aria-hidden="true" />
      <span>{textOrDash(props.machine.spec?.os)}</span>
      <span title="Ядра">{coresLabel(props.machine.spec?.cpu)}</span>
      <span title="Память">{gigabytes(props.machine.spec?.memoryGb)}</span>
      <span title="Диск">{gigabytes(props.machine.spec?.diskGb)}</span>
      <Show when={gpuName(props.machine.spec?.gpu)}>
        {(card) => <span>{card()}</span>}
      </Show>
      <span class="ribbon-sep" aria-hidden="true" />
      <span class="ribbon-region" title={`Площадка: ${regionText(regionOf(props.machine))}`}>
        <span class="ribbon-flag" aria-hidden="true">
          {regionFlag(regionOf(props.machine))}
        </span>
        {shortRegion(regionOf(props.machine))}
      </span>
      <span class="ribbon-sep" aria-hidden="true" />
      <span title="Режим оплаты и ставка">
        {modeLabel(props.machine.billing?.mode)} ·{' '}
        {formatMoney(props.machine.billing?.rate_cents_per_hour, { perHour: true })}
      </span>
      <span title={`Потрачено ${formatCents(props.machine.cost_so_far_cents)}`}>
        {formatCents(props.machine.cost_so_far_cents)}
      </span>
      <span
        title={`Срок жизни ${ttlText(props.machine.spec?.ttlSec)}; создана ${formatDate(props.machine.created_at)}; истекает ${formatDate(props.machine.expires_at)}`}
      >
        {ttlText(props.machine.spec?.ttlSec)} · до {formatTime(props.machine.expires_at)}
      </span>
      <span class="ribbon-created">создана {formatTime(props.machine.created_at)}</span>
      <button
        type="button"
        class="ribbon-id"
        title={`Номер машины: ${props.machine.id}. Нажмите, чтобы скопировать.`}
        onClick={() => void copyId()}
      >
        {copied() ? 'Скопировано' : shortId(props.machine.id, 8)}
      </button>
    </div>
  )
}

export default function ConsoleMachine(): JSX.Element {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const session = useConsoleSession()
  const toast = useToast()

  const machineId = (): string => params.id ?? ''
  const [sandbox, setSandbox] = createSignal<Sandbox | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [loadError, setLoadError] = createSignal<string | null>(null)
  const [refreshError, setRefreshError] = createSignal<string | null>(null)
  const [refreshing, setRefreshing] = createSignal(false)
  const [stopping, setStopping] = createSignal(false)
  const [deleting, setDeleting] = createSignal(false)
  const [actionError, setActionError] = createSignal<string | null>(null)
  const [confirmStop, setConfirmStop] = createSignal(false)
  const [confirmDelete, setConfirmDelete] = createSignal(false)
  const [renameOpen, setRenameOpen] = createSignal(false)
  const [renameValue, setRenameValue] = createSignal('')
  const [renaming, setRenaming] = createSignal(false)
  const [renameError, setRenameError] = createSignal<string | null>(null)

  const state = (): SandboxState | null => sandbox()?.state ?? null
  const currentLabel = (): string => {
    const current = state()
    return current === null ? 'Неизвестно' : labelForState(current)
  }
  const currentTone = (): BadgeTone => {
    const current = state()
    return current === null ? 'neutral' : toneForState(current)
  }
  const isRunning = (): boolean => state() === 'running'
  const canStop = (): boolean => {
    const current = state()
    return current === 'queued' || current === 'running' || current === 'starting' || current === 'paused'
  }
  const accessReason = (): string =>
    `Терминал, файлы и доступ к сети работают только на запущенной машине. Сейчас машина ${currentLabel().toLowerCase()}.`

  const promptUser = (): string => (session.guest() ? 'guest' : 'user')

  let loadToken = 0

  const load = async (initial: boolean): Promise<void> => {
    const id = machineId()
    if (!initial && (loading() || refreshing())) return
    if (id.length === 0) {
      setLoadError('В адресе нет номера машины. Откройте её из списка.')
      setLoading(false)
      return
    }
    const token = ++loadToken
    if (initial) {
      setLoading(true)
      setLoadError(null)
    } else {
      setRefreshing(true)
    }
    try {
      const value = await api.sandbox(id)
      if (token !== loadToken) return
      setSandbox(value)
      setLoadError(null)
      setRefreshError(null)
    } catch (error) {
      if (token !== loadToken) return
      const text = errorText(error)
      if (initial || sandbox() === null) setLoadError(`Не удалось получить машину: ${text}`)
      else setRefreshError(text)
    } finally {
      if (token === loadToken) {
        if (initial) setLoading(false)
        setRefreshing(false)
      }
    }
  }

  // The router keeps this component alive when only the id changes, so a new
  // machine clears the old card, transcript and file before it is fetched.
  createEffect(
    on(machineId, () => {
      setSandbox(null)
      setLoadError(null)
      setRefreshError(null)
      setActionError(null)
      setRefreshing(false)
      setStopping(false)
      setDeleting(false)
      setConfirmStop(false)
      setConfirmDelete(false)
      setRenameOpen(false)
      setRenameValue('')
      setRenameError(null)
      setRenaming(false)
      void load(true)
    }),
  )

  // A running machine's cost and state move; a boot or a stop moves too. Refresh
  // every 5 s in those states and stop the timer on any other state and unmount.
  let poll: number | undefined
  const stopPolling = (): void => {
    if (poll !== undefined) {
      window.clearInterval(poll)
      poll = undefined
    }
  }
  createEffect(
    on(
      () => sandbox()?.state,
      (current) => {
        stopPolling()
        if (current !== undefined && POLLED_STATES.includes(current)) {
          poll = window.setInterval(() => void load(false), POLL_MS)
        }
      },
    ),
  )
  onCleanup(stopPolling)

  const stopMachine = async (): Promise<void> => {
    const current = sandbox()
    if (current === null) return
    setConfirmStop(false)
    setStopping(true)
    setActionError(null)
    try {
      const updated = await api.stopSandbox(current.id)
      // A poll that started before the stop must not paint «работает» over the
      // settled answer, so its result is dropped and the timer stops with it.
      loadToken += 1
      setRefreshing(false)
      setSandbox(updated)
      toast.success('Машина остановлена: плата рассчитана по фактическому времени.')
      void session.refreshAccount()
    } catch (error) {
      setActionError(`Не удалось остановить машину: ${errorText(error)}`)
    } finally {
      setStopping(false)
    }
  }

  const deleteMachine = async (): Promise<void> => {
    const current = sandbox()
    if (current === null) return
    setConfirmDelete(false)
    setDeleting(true)
    setActionError(null)
    try {
      await api.deleteSandbox(current.id)
      toast.success('Машина удалена. Строка счёта за прошедшее время осталась.')
      void session.refreshAccount()
      navigate('/console/machines', { replace: true })
    } catch (error) {
      // A machine that is already gone is not a failure for the person leaving.
      if (error instanceof ApiError && error.status === 404) {
        toast.show({ message: 'Машины уже нет — карточка закрыта.', tone: 'warning' })
        void session.refreshAccount()
        navigate('/console/machines', { replace: true })
        return
      }
      setActionError(`Не удалось удалить машину: ${errorText(error)}`)
    } finally {
      setDeleting(false)
    }
  }

  /** The title shows the person's name once the machine is known; before that,
   * the id is the only thing that identifies it. */
  const titleName = (): string => {
    const current = sandbox()
    return current === null ? shortId(machineId(), 8) : machineName(current)
  }

  const openRename = (): void => {
    const current = sandbox()
    if (current === null) return
    const custom = typeof current.display_name === 'string' ? current.display_name.trim() : ''
    setRenameValue(custom)
    setRenameError(null)
    setRenameOpen(true)
  }

  const closeRename = (): void => {
    if (renaming()) return
    setRenameOpen(false)
    setRenameError(null)
  }

  const saveName = async (): Promise<void> => {
    if (renaming()) return
    const current = sandbox()
    if (current === null) return
    const value = renameValue().trim().replace(/\s+/g, ' ')
    setRenaming(true)
    setRenameError(null)
    try {
      const updated = await api.updateSandbox(current.id, { displayName: value })
      // A poll that started before the rename must not paint the old name back
      // over the server's answer, so its result is dropped and the timer stops.
      loadToken += 1
      setRefreshing(false)
      setSandbox(updated)
      setRenameOpen(false)
      toast.success(
        value.length > 0
          ? `Машина теперь называется «${value}».`
          : `Своё имя убрано: машина снова называется ${machineDisplayName(updated.spec)}.`,
      )
    } catch (error) {
      setRenameError(`Не удалось сохранить название: ${errorText(error)}`)
    } finally {
      setRenaming(false)
    }
  }

  return (
    <section class="page machine-page">
      <PageHeader
        back={{ href: '/console/machines', label: 'Все машины' }}
        eyebrow="Машина"
        title={machineId().length === 0 ? 'Машина' : `Машина ${titleName()}`}
        description="Состав, доступ, терминал и файлы одной машины."
        actions={
          <>
            <Badge tone={currentTone()} dot>
              {currentLabel()}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              icon={<Icon name="pencil" size={14} />}
              disabled={loading() || sandbox() === null}
              onClick={openRename}
            >
              Переименовать
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={refreshing()}
              disabled={loading()}
              onClick={() => void load(false)}
            >
              Обновить
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Icon name="stop" size={14} />}
              loading={stopping()}
              disabled={!canStop() || loading()}
              onClick={() => setConfirmStop(true)}
            >
              Остановить
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={<Icon name="trash" size={14} />}
              disabled={deleting() || loading() || sandbox() === null}
              onClick={() => setConfirmDelete(true)}
            >
              Удалить
            </Button>
          </>
        }
      />

      <Show when={loading()}>
        <Card title="Машина">
          <Skeleton lines={7} />
        </Card>
      </Show>

      <Show when={!loading() && loadError() !== null && sandbox() === null}>
        <Card>
          <EmptyState
            icon="server"
            title="Машина не открылась"
            description={loadError() ?? undefined}
            action={
              <div class="machine-error-actions">
                <Button variant="primary" size="sm" onClick={() => void load(true)}>
                  Повторить
                </Button>
                <A class="btn btn-secondary btn-sm" href="/console">
                  Открыть кабинет
                </A>
              </div>
            }
          />
        </Card>
      </Show>

      <Show when={!loading() && sandbox() !== null}>
        <Show when={refreshError() !== null}>
          <div class="machine-notice" role="status">
            <span class="machine-notice-text">Обновление не удалось: {refreshError()}</span>
            <span class="machine-notice-actions">
              <Button variant="ghost" size="sm" onClick={() => void load(false)}>
                Повторить
              </Button>
              <button
                type="button"
                class="machine-notice-close"
                aria-label="Скрыть сообщение об обновлении"
                onClick={() => setRefreshError(null)}
              >
                ×
              </button>
            </span>
          </div>
        </Show>

        <Show when={actionError() !== null}>
          <div class="machine-notice machine-notice-danger" role="alert">
            <span class="machine-notice-text">{actionError()}</span>
            <span class="machine-notice-actions">
              <button
                type="button"
                class="machine-notice-close"
                aria-label="Скрыть сообщение об ошибке"
                onClick={() => setActionError(null)}
              >
                ×
              </button>
            </span>
          </div>
        </Show>

        <Show when={sandbox()}>
          {(machine) => (
            <>
              <MachineRibbon machine={machine()} />
              <MachineAccess
                sandboxId={machine().id}
                enabled={isRunning()}
                reason={accessReason()}
              />
              <MachineWorkspace
                sandbox={machine()}
                enabled={isRunning()}
                disabledReason={accessReason()}
                promptUser={promptUser()}
                promptHost={machineName(machine()).replace(/\s+/g, '-')}
              />
              <div class="machine-extra">
                <MachineMetrics sandboxId={machine().id} enabled={isRunning()} />
                <MachineSnapshots sandboxId={machine().id} enabled={isRunning()} />
                <MachineAccessJournal sandboxId={machine().id} />
              </div>
            </>
          )}
        </Show>
      </Show>

      <Dialog
        open={renameOpen()}
        onClose={closeRename}
        title="Название машины"
        subtitle="Видно только в кабинете: на машине ничего не меняется."
        footer={
          <>
            <Button variant="ghost" disabled={renaming()} onClick={closeRename}>
              Отмена
            </Button>
            <Button variant="primary" loading={renaming()} onClick={() => void saveName()}>
              Сохранить
            </Button>
          </>
        }
      >
        <Field
          label="Название"
          for="machine-rename-input"
          error={renameError()}
          hint={`Пустое поле вернёт имя по составу: ${machineDisplayName(sandbox()?.spec)}. Системный пользователь на машине остаётся daytona.`}
        >
          <input
            id="machine-rename-input"
            class="input"
            type="text"
            maxlength={64}
            placeholder={machineDisplayName(sandbox()?.spec)}
            value={renameValue()}
            disabled={renaming()}
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

      <Dialog
        open={confirmStop()}
        onClose={() => setConfirmStop(false)}
        title="Остановить машину?"
        subtitle="Счёт закроется по ставке этой машины."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmStop(false)}>
              Отмена
            </Button>
            <Button variant="primary" loading={stopping()} onClick={() => void stopMachine()}>
              Остановить
            </Button>
          </>
        }
      >
        <p>
          Машина остановится, счёт закроется, а запустить её снова из кабинета нельзя. Если что-то
          на машине ещё нужно, скопируйте это через терминал или файлы до остановки.
        </p>
      </Dialog>

      <Dialog
        open={confirmDelete()}
        onClose={() => setConfirmDelete(false)}
        title="Удалить машину?"
        subtitle="Строка счёта за прошедшее время останется."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Отмена
            </Button>
            <Button variant="danger" loading={deleting()} onClick={() => void deleteMachine()}>
              Удалить
            </Button>
          </>
        }
      >
        <p>
          Машина и её диск пропадут. Вернуть их нельзя, счёт за уже отработанное время сохранится.
        </p>
      </Dialog>
    </section>
  )
}

import { A, useNavigate, useParams } from '@solidjs/router'
import { Show, createEffect, createSignal, on, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'

import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Icon,
  Money,
  PageHeader,
  Skeleton,
  Tabs,
  useToast,
} from '@/components'
import type { BadgeTone } from '@/components'
import { ApiError, api } from '@/lib/api'
import type { Sandbox, SandboxState } from '@/lib/api'
import { formatDate, shortId } from '@/lib/format'

import { useConsoleSession } from './components/console-session'
import {
  coresLabel,
  errorText,
  gpuName,
  modeLabel,
  regionLabel,
  stateLabel as labelForState,
  stateTone as toneForState,
  ttlLabel,
} from './components/console-ui'

import Files from './Files'
import Terminal from './Terminal'
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

function Fact(props: { label: string; children?: JSX.Element; note?: string }): JSX.Element {
  return (
    <div class="machine-fact">
      <dt>{props.label}</dt>
      <dd>
        {props.children ?? '—'}
        <Show when={props.note !== undefined}>
          <span class="machine-fact-note">{props.note}</span>
        </Show>
      </dd>
    </div>
  )
}

/** Money for an optional field: a missing rate reads as a dash, not «—/ч». */
function Price(props: { cents: number | null | undefined; perHour?: boolean }): JSX.Element {
  return typeof props.cents === 'number' ? (
    <Money cents={props.cents} perHour={props.perHour} />
  ) : (
    <span>—</span>
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
  const [tab, setTab] = createSignal<'terminal' | 'files'>('terminal')

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
    `Терминал и файлы доступны только на запущенной машине. Сейчас машина ${currentLabel().toLowerCase()}.`

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
      setTab('terminal')
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

  return (
    <section class="page machine-page">
      <PageHeader
        back={{ href: '/console/machines', label: 'Все машины' }}
        eyebrow="Машина"
        title={machineId().length === 0 ? 'Машина' : `Машина ${shortId(machineId(), 8)}`}
        description="Состав, цена, срок жизни, терминал и файлы одной машины."
        actions={
          <>
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
            <Card
              title="Состав и цена"
              subtitle="Ресурсы, площадка и режим оплаты этой машины."
              actions={
                <Badge tone={currentTone()} dot>
                  {currentLabel()}
                </Badge>
              }
            >
              <dl class="machine-facts">
                <Fact label="Образ">
                  {textOrDash(machine().spec?.snapshot ?? machine().spec?.image)}
                </Fact>
                <Fact label="Система">{textOrDash(machine().spec?.os)}</Fact>
                <Fact label="Ядра">{coresLabel(machine().spec?.cpu)}</Fact>
                <Fact label="Память">{gigabytes(machine().spec?.memoryGb)}</Fact>
                <Fact label="Диск">{gigabytes(machine().spec?.diskGb)}</Fact>
                <Fact label="Видеокарта">{gpuName(machine().spec?.gpu) ?? '—'}</Fact>
                <Fact label="Площадка">{regionText(regionOf(machine()))}</Fact>
                <Fact label="Поставщик">{textOrDash(machine().provider)}</Fact>
                <Fact
                  label="Режим оплаты"
                  note={
                    machine().billing?.mode === 'byok'
                      ? 'железо оплачиваете поставщику напрямую'
                      : machine().billing?.mode === 'managed'
                        ? 'полную цену платит кошелёк'
                        : undefined
                  }
                >
                  {modeLabel(machine().billing?.mode)}
                </Fact>
                <Fact label="Цена часа">
                  <Price cents={machine().billing?.rate_cents_per_hour} perHour />
                </Fact>
                <Show when={machine().billing?.mode === 'byok'}>
                  <Fact label="Сервисный сбор" note="только он списывается с кошелька">
                    <Price cents={machine().billing?.service_fee_cents_per_hour} perHour />
                  </Fact>
                </Show>
                <Fact label="Потрачено" note="счётчик растёт по ставке, пока машина работает">
                  <Price cents={machine().cost_so_far_cents} />
                </Fact>
                <Fact label="Срок жизни">{ttlText(machine().spec?.ttlSec)}</Fact>
                <Fact label="Создана">{formatDate(machine().created_at)}</Fact>
                <Fact label="Истекает">
                  {machine().expires_at === null || machine().expires_at === undefined
                    ? '—'
                    : formatDate(machine().expires_at)}
                </Fact>
                <Fact label="Номер">
                  <span class="machine-id">{machine().id}</span>
                </Fact>
              </dl>
            </Card>
          )}
        </Show>

        <div class="machine-access">
          <Tabs
            items={[
              { id: 'terminal', label: 'Терминал' },
              { id: 'files', label: 'Файлы' },
            ]}
            active={tab()}
            onChange={(id) => setTab(id === 'files' ? 'files' : 'terminal')}
            label="Терминал и файлы машины"
          />
          <div
            class="machine-tab-panel"
            role="tabpanel"
            id="panel-terminal"
            aria-labelledby="tab-terminal"
            classList={{ 'is-hidden': tab() !== 'terminal' }}
          >
            <Show when={sandbox()}>
              {(machine) => (
                <Terminal
                  sandboxId={machine().id}
                  shortId={shortId(machine().id, 8)}
                  enabled={isRunning()}
                  disabledReason={accessReason()}
                  visible={tab() === 'terminal'}
                />
              )}
            </Show>
          </div>
          <div
            class="machine-tab-panel"
            role="tabpanel"
            id="panel-files"
            aria-labelledby="tab-files"
            classList={{ 'is-hidden': tab() !== 'files' }}
          >
            <Show when={sandbox()}>
              {(machine) => (
                <Files
                  sandboxId={machine().id}
                  enabled={isRunning()}
                  reason={accessReason()}
                />
              )}
            </Show>
          </div>
        </div>
      </Show>

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

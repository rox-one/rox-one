import { A } from '@solidjs/router'
import { For, Show, createMemo, createSignal, onMount } from 'solid-js'
import type { JSX } from 'solid-js'

import { Badge, Button, Card, Dialog, EmptyState, PageHeader, Skeleton, useToast } from '@/components'
import { api } from '@/lib/api'
import type { Sandbox } from '@/lib/api'
import { formatCents, formatDate, formatMoney, shortId } from '@/lib/format'

import { useConsoleSession } from './components/console-session'
import {
  errorText,
  modeLabel,
  regionFlag,
  regionLabel,
  sizeLine,
  stateLabel,
  stateTone,
} from './components/console-ui'

import './machines.css'

function snapshotName(sandbox: Sandbox): string {
  const spec = sandbox.spec
  const name = spec?.snapshot ?? spec?.image
  return typeof name === 'string' && name.length > 0 ? name : 'образ по умолчанию'
}

function sandboxRegion(sandbox: Sandbox): string {
  const fromSpec = sandbox.spec?.region
  if (typeof fromSpec === 'string' && fromSpec.length > 0) return fromSpec
  const top = sandbox['region']
  return typeof top === 'string' ? top : ''
}

const STOPPABLE: readonly string[] = ['queued', 'starting', 'running', 'paused']

interface PendingAction {
  kind: 'stop' | 'delete'
  sandbox: Sandbox
}

export default function ConsoleMachines(): JSX.Element {
  const session = useConsoleSession()
  const toast = useToast()

  const [rows, setRows] = createSignal<Sandbox[]>([])
  const [loading, setLoading] = createSignal(true)
  const [failure, setFailure] = createSignal<string | null>(null)
  const [pending, setPending] = createSignal<PendingAction | null>(null)
  const [acting, setActing] = createSignal<string | null>(null)
  const [actionError, setActionError] = createSignal<string | null>(null)

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
      setRows(sorted)
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

      <Show when={!loading() && failure() === null && rows().length > 0}>
        <div class="machines-count">
          Всего {rows().length} · работают {working()}
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

      <Show
        when={!loading()}
        fallback={
          <div class="machines-grid" aria-live="polite">
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
          <div class="machines-grid">
            <For each={rows()}>
              {(sandbox) => {
                const busy = (): boolean => acting() === sandbox.id
                return (
                  <article class="machine-card" aria-labelledby={`machine-${sandbox.id}-name`}>
                    <header class="machine-card-head">
                      <div class="machine-card-id">
                        <h2 class="machine-card-name" id={`machine-${sandbox.id}-name`}>
                          {snapshotName(sandbox)}
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
                        <dt>Поставщик</dt>
                        <dd>{sandbox.provider}</dd>
                      </div>
                      <div>
                        <dt>Оплата</dt>
                        <dd>
                          <Badge tone={sandbox.billing?.mode === 'byok' ? 'success' : 'accent'}>
                            {modeLabel(sandbox.billing?.mode)}
                          </Badge>{' '}
                          <span class="machine-rate">
                            {formatMoney(sandbox.billing?.rate_cents_per_hour, { perHour: true })}
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt>Списано</dt>
                        <dd>{formatCents(sandbox.cost_so_far_cents ?? 0)}</dd>
                      </div>
                      <div>
                        <dt>Срок</dt>
                        <dd>
                          {sandbox.expires_at === null || sandbox.expires_at === undefined
                            ? 'без ограничения'
                            : `до ${formatDate(sandbox.expires_at)}`}
                        </dd>
                      </div>
                    </dl>

                    <footer class="machine-card-actions">
                      <A
                        href={`/console/machines/${sandbox.id}`}
                        class="btn btn-primary btn-sm"
                        aria-label={`Открыть машину ${shortId(sandbox.id, 8)}: терминал, файлы и просмотр`}
                      >
                        Открыть
                      </A>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy() || !STOPPABLE.includes(sandbox.state)}
                        loading={busy() && pending()?.kind === 'stop'}
                        onClick={() => ask({ kind: 'stop', sandbox })}
                      >
                        Остановить
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busy()}
                        loading={busy() && pending()?.kind === 'delete'}
                        onClick={() => ask({ kind: 'delete', sandbox })}
                      >
                        Удалить
                      </Button>
                    </footer>
                  </article>
                )
              }}
            </For>
          </div>
        </Show>
      </Show>

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
            Машина удалится у поставщика: файлы внутри неё пропадут. Остаток резерва вернётся на счёт, а
            строка счёта останется в истории.
          </p>
        </Show>
      </Dialog>
    </section>
  )
}

import { useNavigate } from '@solidjs/router'
import { For, Show, createEffect, createMemo, createSignal, on } from 'solid-js'
import type { JSX } from 'solid-js'

import { Badge, Button, Card, Field, Skeleton } from '@/components'
import type { BadgeTone } from '@/components'
import { api } from '@/lib/api'
import type { SnapshotInfo } from '@/lib/api'
import { formatDate } from '@/lib/format'

import { errorText } from './components/console-ui'

import './machine-panels.css'

const URL_SECRET = /\b(?:https?|wss?):\/\/[^\s<>"']+/gi
const NAMED_SECRET = /\b(token|secret|password|passwd|api[_-]?key|key)=[^\s,&;]+/gi

/** The server's own words, with any address or named secret cut out. */
function safeError(err: unknown): string {
  return errorText(err).replace(URL_SECRET, '[адрес скрыт]').replace(NAMED_SECRET, '$1=скрыт')
}

const SNAPSHOT_LABELS: Record<string, string> = {
  queued: 'В очереди',
  pending: 'В очереди',
  building: 'Создаётся',
  creating: 'Создаётся',
  ready: 'Готов',
  active: 'Готов',
  available: 'Готов',
  done: 'Готов',
  inactive: 'Неактивен',
  failed: 'Ошибка',
  error: 'Ошибка',
  deleting: 'Удаляется',
  deleted: 'Удалён',
}

function snapshotTone(state: string): BadgeTone {
  if (state === 'ready' || state === 'available' || state === 'done' || state === 'active') {
    return 'success'
  }
  if (state === 'failed' || state === 'error') return 'danger'
  if (
    state === 'creating' ||
    state === 'building' ||
    state === 'pending' ||
    state === 'queued' ||
    state === 'deleting'
  ) {
    return 'accent'
  }
  return 'neutral'
}

export interface MachineSnapshotsProps {
  sandboxId: string
  enabled: boolean
}

/**
 * Snapshots of the machine's disk. One button saves a checkpoint, another
 * starts a clone from it; the clone opens as a new machine of its own.
 */
export default function MachineSnapshots(props: MachineSnapshotsProps): JSX.Element {
  const navigate = useNavigate()

  const [rows, setRows] = createSignal<SnapshotInfo[]>([])
  const [loading, setLoading] = createSignal(true)
  const [failure, setFailure] = createSignal<string | null>(null)
  const [name, setName] = createSignal('')
  const [creating, setCreating] = createSignal(false)
  const [actionError, setActionError] = createSignal<string | null>(null)
  const [cloning, setCloning] = createSignal<string | null>(null)

  let token = 0

  const load = async (): Promise<void> => {
    if (!props.enabled || props.sandboxId.length === 0) return
    const mine = ++token
    setLoading(true)
    try {
      const list = await api.snapshots(props.sandboxId)
      if (mine !== token) return
      setRows([...list].sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0)))
      setFailure(null)
    } catch (err) {
      if (mine !== token) return
      setFailure(safeError(err))
    } finally {
      if (mine === token) setLoading(false)
    }
  }

  // A new sandbox object arrives with every live frame; only a new machine or
  // a new running state may clear the list. A primitive key keeps the card
  // from re-listing snapshots every few seconds.
  const resetKey = createMemo(() => `${props.sandboxId}\u0000${props.enabled ? '1' : '0'}`)
  createEffect(
    on(
      resetKey,
      () => {
        // A listing for the previous machine must not paint over this one.
        token += 1
        setRows([])
        setFailure(null)
        setActionError(null)
        setName('')
        setLoading(false)
        setCreating(false)
        setCloning(null)
        if (props.enabled && props.sandboxId.length > 0) void load()
      },
    ),
  )

  const takeSnapshot = async (): Promise<void> => {
    if (!props.enabled || creating() || cloning() !== null) return
    const trimmed = name().trim()
    setCreating(true)
    setActionError(null)
    try {
      const created = await api.createSnapshot(
        props.sandboxId,
        trimmed.length > 0 ? { name: trimmed } : {},
      )
      const row: SnapshotInfo = { ...created, createdAt: created.createdAt ?? Date.now() }
      // A listing that started before the create must not erase the new row.
      token += 1
      setRows((current) => [row, ...current.filter((item) => item.name !== row.name)])
      setFailure(null)
      setName('')
    } catch (err) {
      setActionError(`Снимок не создан: ${safeError(err)}`)
    } finally {
      setCreating(false)
    }
  }

  const cloneFrom = async (snapshot: string): Promise<void> => {
    if (!props.enabled || cloning() !== null) return
    setCloning(snapshot)
    setActionError(null)
    try {
      const machine = await api.createSandbox({ snapshot })
      navigate(`/console/machines/${encodeURIComponent(machine.id)}`)
    } catch (err) {
      setActionError(`Клон не запустился: ${safeError(err)}`)
    } finally {
      setCloning(null)
    }
  }

  return (
    <Card
      title="Снимки"
      subtitle="Снимок сохраняет диск машины; из готового снимка можно запустить клон."
    >
      <Show when={!props.enabled}>
        <p class="mp-note">
          Снимки доступны на запущенной машине. Запустите её, чтобы сохранить диск или поднять
          клон.
        </p>
      </Show>

      <Show when={props.enabled}>
        <div class="mp-stack">
          <div class="mp-form">
            <Field label="Имя снимка" for="mp-snapshot-name">
              <input
                id="mp-snapshot-name"
                class="input"
                type="text"
                maxlength={64}
                placeholder="например, перед-обновлением"
                value={name()}
                disabled={creating()}
                onInput={(event) => setName(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void takeSnapshot()
                  }
                }}
              />
            </Field>
            <Button
              variant="primary"
              size="sm"
              loading={creating()}
              disabled={cloning() !== null}
              onClick={() => void takeSnapshot()}
            >
              Снять снимок
            </Button>
          </div>

          <p class="mp-note">
            Имя необязательно: латиница, цифры, «.», «_», «-». С пустым именем сервер назовёт
            снимок сам.
          </p>

          <Show when={actionError() !== null}>
            <p class="mp-error-quiet" role="alert">
              {actionError()}
            </p>
          </Show>

          <Show when={failure() !== null && rows().length === 0}>
            <p class="mp-error-quiet" role="alert">
              Снимки не загрузились: {failure()}{' '}
              <button type="button" class="mp-link-button" onClick={() => void load()}>
                Повторить
              </button>
            </p>
          </Show>

          <Show when={loading() && rows().length === 0 && failure() === null}>
            <Skeleton lines={2} />
          </Show>

          <Show when={!loading() && rows().length === 0 && failure() === null}>
            <p class="mp-note">
              Снимков пока нет. Снимите первый — он сохранит диск машины, и из него можно будет
              запустить клон.
            </p>
          </Show>

          <Show when={rows().length > 0}>
            <ul class="mp-snap-list" aria-label="Снимки машины">
              <For each={rows()}>
                {(row) => (
                  <li class="mp-snap-row">
                    <div class="mp-snap-main">
                      <span class="mp-snap-name" title={row.name}>
                        {row.name}
                      </span>
                      <span class="mp-snap-meta">
                        <Badge tone={snapshotTone(row.state)} dot>
                          {SNAPSHOT_LABELS[row.state] ?? (row.state.length > 0 ? row.state : 'Неизвестно')}
                        </Badge>
                        <span class="mp-snap-date">{formatDate(row.createdAt)}</span>
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={cloning() === row.name}
                      disabled={cloning() !== null && cloning() !== row.name}
                      onClick={() => void cloneFrom(row.name)}
                    >
                      Запустить клон
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <Show when={failure() !== null && rows().length > 0}>
            <p class="mp-error-quiet" role="status">
              Список не обновился: {failure()}. Показаны последние полученные снимки.
            </p>
          </Show>
        </div>
      </Show>
    </Card>
  )
}

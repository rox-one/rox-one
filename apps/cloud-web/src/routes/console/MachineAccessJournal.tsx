import { For, Show, createEffect, createSignal, on } from 'solid-js'
import type { JSX } from 'solid-js'

import { Card, Skeleton } from '@/components'
import { api } from '@/lib/api'
import type { AuditEntry } from '@/lib/api'
import { formatDate, formatTime } from '@/lib/format'

import { errorText, ttlLabel } from './components/console-ui'

import './machine-panels.css'

const URL_SECRET = /\b(?:https?|wss?):\/\/[^\s<>"']+/gi
const NAMED_SECRET = /\b(token|secret|password|passwd|api[_-]?key|key)=[^\s,&;]+/gi

/** The server's own words, with any address or named secret cut out. */
function safeError(err: unknown): string {
  return errorText(err).replace(URL_SECRET, '[адрес скрыт]').replace(NAMED_SECRET, '$1=скрыт')
}

const ACCESS_LABELS: Record<string, string> = {
  'sandbox.preview': 'Ссылка на сайт',
  'sandbox.ssh': 'SSH-доступ',
}

/**
 * Only the two fields a person needs from `details`. Everything else stays on
 * the server, so a signed link or a key can never reach this list.
 */
function accessDetail(entry: AuditEntry): string {
  const details: Record<string, unknown> = entry.details ?? {}
  const parts: string[] = []
  if (typeof details.port === 'number') parts.push(`порт ${details.port}`)
  const ttl = typeof details.ttl_sec === 'number' ? details.ttl_sec : details.ttl
  if (typeof ttl === 'number') parts.push(`до ${ttlLabel(ttl)}`)
  return parts.join(' · ')
}

export interface MachineAccessJournalProps {
  sandboxId: string
}

/**
 * The last eight signed links and SSH entries of one machine, read from the
 * customer's own journal. The list never holds a link or a key, only the fact
 * of access with its port and lifetime.
 */
export default function MachineAccessJournal(props: MachineAccessJournalProps): JSX.Element {
  const [rows, setRows] = createSignal<AuditEntry[]>([])
  const [loading, setLoading] = createSignal(true)
  const [failure, setFailure] = createSignal<string | null>(null)

  let token = 0

  const load = async (): Promise<void> => {
    if (props.sandboxId.length === 0) {
      setLoading(false)
      return
    }
    const mine = ++token
    setLoading(true)
    setFailure(null)
    try {
      const listing = await api.audit({ limit: 50 })
      if (mine !== token) return
      const picked = listing.data
        .filter(
          (entry) =>
            ACCESS_LABELS[entry.action] !== undefined && entry.target_id === props.sandboxId,
        )
        .sort((left, right) => {
          const a = Date.parse(left.at)
          const b = Date.parse(right.at)
          return (Number.isFinite(b) ? b : 0) - (Number.isFinite(a) ? a : 0)
        })
        .slice(0, 8)
      setRows(picked)
    } catch (err) {
      if (mine !== token) return
      setFailure(safeError(err))
    } finally {
      if (mine === token) setLoading(false)
    }
  }

  createEffect(
    on(
      () => props.sandboxId,
      () => {
        token += 1
        setRows([])
        setFailure(null)
        void load()
      },
    ),
  )

  return (
    <Card
      title="Журнал доступа"
      subtitle="Последние ссылки на сайт и входы по SSH: когда, что и на каком порту."
    >
      <div class="mp-stack">
        <Show when={loading() && rows().length === 0}>
          <Skeleton lines={2} />
        </Show>

        <Show when={failure() !== null && rows().length === 0}>
          <p class="mp-error-quiet" role="alert">
            Журнал не загрузился: {failure()}{' '}
            <button type="button" class="mp-link-button" onClick={() => void load()}>
              Повторить
            </button>
          </p>
        </Show>

        <Show when={!loading() && failure() === null && rows().length === 0}>
          <p class="mp-note">
            Пока никто не открывал сайт и не входил по SSH. Здесь появятся последние восемь
            доступов к этой машине.
          </p>
        </Show>

        <Show when={rows().length > 0}>
          <ul class="mp-log" aria-label="Последние доступы к машине">
            <For each={rows()}>
              {(entry) => (
                <li class="mp-log-row">
                  <time class="mp-log-time" datetime={entry.at} title={formatDate(entry.at)}>
                    {formatTime(entry.at)}
                  </time>
                  <span class="mp-log-action">{ACCESS_LABELS[entry.action]}</span>
                  <span class="mp-log-detail">{accessDetail(entry) || '—'}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <Show when={failure() !== null && rows().length > 0}>
          <p class="mp-error-quiet" role="status">
            Журнал не обновился: {failure()}. Показаны последние полученные записи.
          </p>
        </Show>
      </div>
    </Card>
  )
}

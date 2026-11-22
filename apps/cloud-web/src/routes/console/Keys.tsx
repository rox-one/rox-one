import { For, Show, createSignal, onMount } from 'solid-js'
import type { JSX } from 'solid-js'

import {
  Badge,
  Button,
  Card,
  CodeBlock,
  Dialog,
  EmptyState,
  PageHeader,
  Table,
} from '@/components'
import type { TableColumn } from '@/components'
import { ApiError, api } from '@/lib/api'
import type { ApiKeyRow } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { getClientKey } from '@/lib/session'

import { useConsoleSession } from './components/console-session'
import { errorText } from './components/console-ui'

import './keys.css'

const KEY_PREFIX = 'rox_sk_live_'

/**
 * The two pieces of the tab's own key this page may name: the public prefix
 * and the last four characters. Anything shorter than a full key keeps the
 * prefix alone, so the plate can never spell the secret it describes.
 */
function describeClientKey(secret: string): { head: string; tail: string } | null {
  const key = secret.trim()
  if (key.length === 0) return null
  const prefix = key.startsWith(KEY_PREFIX) ? KEY_PREFIX : ''
  const tail = key.length >= prefix.length + 8 ? key.slice(-4) : ''
  return { head: prefix === '' ? 'ключ' : prefix, tail }
}

const SCOPES: readonly { id: string; label: string; hint: string }[] = [
  {
    id: 'sandboxes:read',
    label: 'Смотреть машины',
    hint: 'Список, состав, терминал и файлы на чтение',
  },
  {
    id: 'sandboxes:write',
    label: 'Управлять машинами',
    hint: 'Запуск, команды, остановка и удаление',
  },
  {
    id: 'billing:read',
    label: 'Читать счёт',
    hint: 'Баланс, резерв и строки счёта',
  },
  {
    id: 'keys:write',
    label: 'Управлять ключами',
    hint: 'Выпускать и удалять такие же ключи для программ и коллег',
  },
]

const DEFAULT_SCOPES: readonly string[] = ['sandboxes:read', 'sandboxes:write', 'billing:read']

function scopeLabel(id: string): string {
  return SCOPES.find((scope) => scope.id === id)?.label ?? id
}

export default function ConsoleKeys(): JSX.Element {
  const session = useConsoleSession()
  const currentKey = describeClientKey(getClientKey())

  const [rows, setRows] = createSignal<ApiKeyRow[]>([])
  const [loading, setLoading] = createSignal(true)
  const [failure, setFailure] = createSignal<string | null>(null)
  /** The key is real but lacks `keys:write`; that is an explanation, not an error. */
  const [denied, setDenied] = createSignal(false)

  const [open, setOpen] = createSignal(false)
  const [scopes, setScopes] = createSignal<string[]>([...DEFAULT_SCOPES])
  const [creating, setCreating] = createSignal(false)
  const [createError, setCreateError] = createSignal<string | null>(null)
  const [created, setCreated] = createSignal<ApiKeyRow | undefined>(undefined)

  const load = async (): Promise<void> => {
    setLoading(true)
    setFailure(null)
    setDenied(false)
    try {
      const listing = await api.keys()
      setRows(listing.data)
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) setDenied(true)
      else setFailure(errorText(err))
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    void load()
  })

  const toggleScope = (id: string): void => {
    setScopes((current) =>
      current.includes(id) ? current.filter((scope) => scope !== id) : [...current, id],
    )
    setCreateError(null)
  }

  const openDialog = (): void => {
    setScopes([...DEFAULT_SCOPES])
    setCreateError(null)
    setCreated(undefined)
    setOpen(true)
  }

  const closeDialog = (): void => {
    setOpen(false)
    // The one-time secret dies with the dialog: no copy is kept in the page.
    setCreated(undefined)
    setCreateError(null)
  }

  const create = async (): Promise<void> => {
    if (scopes().length === 0) {
      setCreateError('Выберите хотя бы одно право: ключ без прав ничего не сможет')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const key = await api.createKey(scopes())
      setCreated(key)
      await load()
    } catch (err) {
      setCreateError(errorText(err))
    } finally {
      setCreating(false)
    }
  }

  const columns: readonly TableColumn<ApiKeyRow>[] = [
    {
      key: 'prefix',
      label: 'Ключ',
      render: (row) => (
        <span class="key-plate">
          {row.prefix}
          <span class="key-tail">{row.last4}</span>
        </span>
      ),
    },
    {
      key: 'scopes',
      label: 'Права',
      render: (row) => (
        <div class="key-scopes">
          <For each={row.scopes}>
            {(scope) => <Badge tone="neutral">{scopeLabel(scope)}</Badge>}
          </For>
        </div>
      ),
    },
    {
      key: 'created_at',
      label: 'Создан',
      render: (row) => formatDate(row.created_at),
    },
    {
      key: 'last_used_at',
      label: 'Последний раз',
      render: (row) =>
        row.last_used_at === null || row.last_used_at === undefined
          ? 'ещё не использовался'
          : formatDate(row.last_used_at),
    },
  ]

  return (
    <section class="page keys-page">
      <PageHeader
        eyebrow="Кабинет"
        title="Ключи"
        description="Ключ этой вкладки и ключи для программ и коллег. Полное значение показывается один раз, при создании."
        actions={
          <Show when={!denied() && !session.guest()}>
            <Button size="sm" variant="primary" onClick={openDialog}>
              Создать ключ
            </Button>
          </Show>
        }
      />

      <Show when={failure()}>
        {(message) => (
          <div class="console-alert" role="alert">
            <span>Ключи не загрузились: {message()}</span>
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Повторить
            </Button>
          </div>
        )}
      </Show>

      <Card
        class="keys-current"
        title="Ключ этой вкладки"
        subtitle="Начало и последние четыре знака; полного значения нет ни на экране, ни на сервере"
      >
        <div class="keys-current-row">
          <span class="keys-current-plate">
            <Show
              when={currentKey !== null}
              fallback={<span class="keys-current-empty">Ключа в этой вкладке нет</span>}
            >
              {currentKey?.head}
              <span class="keys-current-dots" aria-hidden="true">
                ••••••••
              </span>
              <Show when={(currentKey?.tail ?? '') !== ''}>
                <span class="key-tail">{currentKey?.tail}</span>
              </Show>
            </Show>
          </span>
          <Show when={session.guest()}>
            <Badge tone="accent" dot>
              Пробный доступ
            </Badge>
          </Show>
        </div>
        <p class="keys-current-note">
          Полного ключа не знает даже сервер: у него остаётся только отпечаток, по которому нельзя
          восстановить секрет. Кабинет держит ключ, пока открыта вкладка, и больше его не показывает —
          после закрытия вкладки ключ придётся ввести заново.
        </p>
        <p class="keys-current-note">
          Другие ключи нужны тому, что работает без вашей вкладки: программам и скриптам, чужим
          рабочим местам, коллегам. У каждого свой набор прав; выданные права нельзя сузить — можно
          только выпустить новый ключ и удалить старый.
        </p>
        <p class="keys-current-note">
          Кнопка «Ввести другой ключ» не выпускает новый ключ: она выходит из текущего и просит
          вставить другой. Ключ этой вкладки заменится, а старый останется на сервере только
          отпечатком.
        </p>
      </Card>

      <Show when={denied() || session.guest() || failure() === null || rows().length > 0}>
        <Card title="Ключи доступа" subtitle="Отпечаток и права; секрет не хранится" flush>
          <Show
            when={!denied() && !session.guest()}
            fallback={
              <Show
                when={session.guest()}
                fallback={
                  <EmptyState
                    icon="key"
                    title="Этому ключу нельзя смотреть ключи"
                    description="У ключа нет права «Управлять ключами»: он работает с машинами и счётом, но не видит и не выпускает другие ключи. Список покажет ключ, у которого это право есть."
                    action={
                      <Button variant="secondary" onClick={() => session.signOut()}>
                        Ввести другой ключ
                      </Button>
                    }
                  />
                }
              >
                <EmptyState
                  icon="key"
                  title="Гостевой вкладке ключи не выдаются"
                  description="Пробный доступ умеет запускать машины и читать счёт, но не выпускает новые ключи — иначе пробу можно было бы продлевать без конца. Для постоянной работы возьмите у дежурного ключ с правом «Управлять ключами»."
                  action={
                    <Button variant="secondary" onClick={() => session.signOut()}>
                      Ввести другой ключ
                    </Button>
                  }
                />
              </Show>
            }
          >
            <Table
              columns={columns}
              rows={rows()}
              rowKey={(row) => row.id}
              label="Ключи клиента"
              loading={loading()}
              empty={
                <EmptyState
                  icon="key"
                  title="Ключей пока нет"
                  description="Создайте ключ, чтобы работать из скриптов, с другого рабочего места или вместе с коллегой. Права выбираются при создании."
                  action={
                    <Button variant="primary" onClick={openDialog}>
                      Создать ключ
                    </Button>
                  }
                />
              }
            />
          </Show>
        </Card>
      </Show>

      <Dialog
        open={open()}
        onClose={closeDialog}
        title={created() === undefined ? 'Новый ключ' : 'Ключ создан'}
        subtitle={
          created() === undefined
            ? 'Права нельзя расширить позже — только выпустить новый ключ'
            : 'Секрет показывается один раз'
        }
        closeOnBackdrop={created() === undefined}
        footer={
          <Show
            when={created() === undefined}
            fallback={
              <Button variant="primary" onClick={closeDialog}>
                Готово
              </Button>
            }
          >
            <Button variant="ghost" onClick={closeDialog}>
              Отмена
            </Button>
            <Button variant="primary" loading={creating()} onClick={() => void create()}>
              Создать ключ
            </Button>
          </Show>
        }
      >
        <Show
          when={created() === undefined}
          fallback={
            <div class="keys-secret">
              <CodeBlock
                code={created()?.api_key ?? ''}
                label="Новый ключ — сохраните сейчас"
              />
              <div class="console-alert" role="alert">
                <span>
                  Скопируйте ключ сейчас: сервер покажет его только этот раз. Храните его в менеджере
                  секретов, а не в переписке.
                </span>
              </div>
            </div>
          }
        >
          <fieldset class="keys-fieldset">
            <legend class="field-label">Что разрешить</legend>
            <For each={SCOPES}>
              {(scope) => (
                <label class="scope-row">
                  <input
                    type="checkbox"
                    checked={scopes().includes(scope.id)}
                    onChange={() => toggleScope(scope.id)}
                  />
                  <span class="scope-text">
                    <span class="scope-label">{scope.label}</span>
                    <span class="scope-hint">{scope.hint}</span>
                  </span>
                </label>
              )}
            </For>
          </fieldset>
          <Show when={createError()}>
            {(message) => (
              <div class="console-alert" role="alert">
                <span>{message()}</span>
              </div>
            )}
          </Show>
        </Show>
      </Dialog>
    </section>
  )
}

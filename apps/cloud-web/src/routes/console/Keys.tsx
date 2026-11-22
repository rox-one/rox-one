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

import { useConsoleSession } from './components/console-session'
import { errorText } from './components/console-ui'

import './keys.css'

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
    hint: 'Выпускать такие же ключи и добавлять ключи поставщиков',
  },
]

const DEFAULT_SCOPES: readonly string[] = ['sandboxes:read', 'sandboxes:write', 'billing:read']

function scopeLabel(id: string): string {
  return SCOPES.find((scope) => scope.id === id)?.label ?? id
}

export default function ConsoleKeys(): JSX.Element {
  const session = useConsoleSession()

  const [rows, setRows] = createSignal<ApiKeyRow[]>([])
  const [loading, setLoading] = createSignal(true)
  const [failure, setFailure] = createSignal<string | null>(null)
  const [forbidden, setForbidden] = createSignal(false)

  const [open, setOpen] = createSignal(false)
  const [scopes, setScopes] = createSignal<string[]>([...DEFAULT_SCOPES])
  const [creating, setCreating] = createSignal(false)
  const [createError, setCreateError] = createSignal<string | null>(null)
  const [created, setCreated] = createSignal<ApiKeyRow | undefined>(undefined)

  const load = async (): Promise<void> => {
    setLoading(true)
    setFailure(null)
    setForbidden(false)
    try {
      const listing = await api.keys()
      setRows(listing.data)
    } catch (err) {
      setFailure(errorText(err))
      setForbidden(err instanceof ApiError && (err.status === 401 || err.status === 403))
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
        description="Ключи, которыми открывается API и кабинет. Полный секрет показывается один раз при создании."
        actions={
          <Show when={!forbidden()}>
            <Button size="sm" variant="primary" onClick={openDialog}>
              Создать ключ
            </Button>
          </Show>
        }
      />

      <Show when={forbidden() ? null : failure()}>
        {(message) => (
          <div class="console-alert" role="alert">
            <span>Ключи не загрузились: {message()}</span>
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Повторить
            </Button>
          </div>
        )}
      </Show>

      <div class="console-note">
        Ключ этой вкладки здесь не показывается: он живёт только в памяти вкладки, а на сервере хранится
        только его отпечаток. Закройте вкладку — ключ исчезнет.
      </div>

      <Show when={forbidden() || failure() === null || rows().length > 0}>
        <Card title="Ключи доступа" subtitle="Отпечаток и права; секрет не хранится" flush>
          <Show
            when={!forbidden()}
            fallback={
              <EmptyState
                icon="key"
                title="Этому ключу нельзя смотреть ключи"
                description="Гостевой доступ выдаётся без права keys:write: он управляет машинами и читает счёт, но не выпускает ключи. Для постоянной работы попросите ключ у дежурного."
                action={
                  <Button variant="secondary" onClick={() => session.signOut()}>
                    Ввести другой ключ
                  </Button>
                }
              />
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
                  description="Создайте ключ, чтобы работать из скриптов или другой вкладки. Права выбираются при создании."
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

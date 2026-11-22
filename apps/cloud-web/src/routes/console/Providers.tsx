import { For, Show, createMemo, createSignal, onMount } from 'solid-js'
import type { JSX } from 'solid-js'

import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Skeleton,
  Table,
  useToast,
} from '@/components'
import type { BadgeTone, TableColumn } from '@/components'
import { ApiError, api } from '@/lib/api'
import type { Catalog, ProviderCapability, ProviderCredential } from '@/lib/api'
import { formatCents, formatDate } from '@/lib/format'

import { useConsoleSession } from './components/console-session'
import { errorText, ttlLabel } from './components/console-ui'

import './providers.css'

const PROVIDER_LABELS: Record<string, string> = {
  daytona: 'Daytona',
  modal: 'Modal',
  e2b: 'E2B',
}

const PROVIDER_NOTES: Record<string, string> = {
  daytona: 'Песочницы Linux, Windows и macOS, снимки и видеокарты. Основной поставщик Rox.',
  modal: 'Linux с видеокартами через мост Rox.',
  e2b: 'Быстрые Linux-песочницы из шаблонов.',
}

const FALLBACK_PROVIDERS: readonly string[] = ['daytona', 'modal', 'e2b']

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  active: { label: 'Работает', tone: 'success' },
  standby: { label: 'В запасе', tone: 'neutral' },
  disabled: { label: 'Отключён', tone: 'neutral' },
  expired: { label: 'Истёк', tone: 'warning' },
}

const HEALTH: Record<string, string> = {
  ok: 'Проверен',
  degraded: 'Сбоит',
  invalid: 'Неверный',
  unknown: 'Не проверялся',
}

function capabilityLabel(capability: ProviderCapability): string {
  return PROVIDER_LABELS[capability.id] ?? capability.id
}

function ttlCap(capability: ProviderCapability): string {
  const max = capability.max_ttl_sec
  if (typeof max !== 'number' || max <= 0) return 'без ограничения'
  return `до ${ttlLabel(max)}`
}

/**
 * The catalog sends a boolean here, while the older client type says a list of
 * models; both shapes mean "this vendor can rent a GPU".
 */
function hasGpu(capability: ProviderCapability): boolean {
  const value: unknown = capability.gpu
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.length > 0
  return value !== undefined && value !== null
}

export default function ConsoleProviders(): JSX.Element {
  const session = useConsoleSession()
  const toast = useToast()

  const [providers, setProviders] = createSignal<ProviderCapability[]>([])
  const [catalog, setCatalog] = createSignal<Catalog | undefined>(undefined)
  const [credentials, setCredentials] = createSignal<ProviderCredential[]>([])
  const [loading, setLoading] = createSignal(true)
  const [failure, setFailure] = createSignal<string | null>(null)
  const [credentialsFailure, setCredentialsFailure] = createSignal<string | null>(null)
  const [credentialsForbidden, setCredentialsForbidden] = createSignal(false)

  const [open, setOpen] = createSignal(false)
  const [provider, setProvider] = createSignal('daytona')
  const [secret, setSecret] = createSignal('')
  const [label, setLabel] = createSignal('')
  const [capText, setCapText] = createSignal('20')
  const [formError, setFormError] = createSignal<string | null>(null)
  const [saving, setSaving] = createSignal(false)

  const [removing, setRemoving] = createSignal<ProviderCredential | null>(null)
  const [removeError, setRemoveError] = createSignal<string | null>(null)
  const [acting, setActing] = createSignal(false)

  const askRemove = (credential: ProviderCredential): void => {
    setRemoveError(null)
    setRemoving(credential)
  }

  const closeRemove = (): void => {
    setRemoving(null)
    setRemoveError(null)
  }

  const load = async (): Promise<void> => {
    setLoading(true)
    setFailure(null)
    try {
      const [capabilities, catalogue] = await Promise.all([api.providers(), api.catalog()])
      setProviders(capabilities)
      setCatalog(catalogue)
    } catch (err) {
      setFailure(errorText(err))
    }
    try {
      const listing = await api.credentials()
      setCredentials(listing.data)
      setCredentialsFailure(null)
      setCredentialsForbidden(false)
    } catch (err) {
      setCredentials([])
      setCredentialsFailure(errorText(err))
      setCredentialsForbidden(err instanceof ApiError && (err.status === 401 || err.status === 403))
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    void load()
  })

  const managed = createMemo<string[]>(() => catalog()?.managed_providers ?? [])

  const providerChoices = createMemo(() => {
    const ids = providers().map((capability) => capability.id)
    const list = ids.length > 0 ? ids : FALLBACK_PROVIDERS
    return list.map((id) => ({ value: id, label: PROVIDER_LABELS[id] ?? id }))
  })

  const openDialog = (): void => {
    const first = providerChoices()[0]
    setProvider(first?.value ?? 'daytona')
    setSecret('')
    setLabel('')
    setCapText('20')
    setFormError(null)
    setOpen(true)
  }

  const add = async (): Promise<void> => {
    const cents = Math.round(Number(capText().replace(',', '.').trim()) * 100)
    if (!Number.isFinite(cents) || cents < 0) {
      setFormError('Потолок расходов: число долларов, например 20 или 20,50')
      return
    }
    if (secret().trim().length === 0) {
      setFormError('Вставьте ключ поставщика: без него машина не запустится')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const trimmedLabel = label().trim()
      await api.addCredential({
        provider: provider(),
        secret: secret().trim(),
        spendCapCents: cents,
        ...(trimmedLabel.length === 0 ? {} : { label: trimmedLabel }),
      })
      toast.success(`Ключ ${PROVIDER_LABELS[provider()] ?? provider()} добавлен`)
      setOpen(false)
      await load()
    } catch (err) {
      setFormError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    const credential = removing()
    if (credential === null) return
    setActing(true)
    try {
      await api.removeCredential(credential.id)
      toast.success('Ключ отключён: новые машины на нём не запустятся')
      setRemoving(null)
      await load()
    } catch (err) {
      // The confirm dialog is modal, so the refusal belongs inside it.
      setRemoveError(errorText(err))
    } finally {
      setActing(false)
    }
  }

  const columns: readonly TableColumn<ProviderCredential>[] = [
    {
      key: 'label',
      label: 'Ключ',
      render: (credential) => (
        <div class="credential-line">
          <span class="credential-name">{credential.label}</span>
          <span class="credential-tail">{`•••• ${credential.last4}`}</span>
        </div>
      ),
    },
    {
      key: 'provider',
      label: 'Поставщик',
      render: (credential) => PROVIDER_LABELS[credential.provider] ?? credential.provider,
    },
    {
      key: 'status',
      label: 'Состояние',
      render: (credential) => {
        const state = STATUS[credential.status] ?? { label: credential.status, tone: 'neutral' as BadgeTone }
        return <Badge tone={state.tone}>{state.label}</Badge>
      },
    },
    {
      key: 'spend_cap_cents',
      label: 'Потолок',
      align: 'right',
      render: (credential) => formatCents(credential.spend_cap_cents),
    },
    {
      key: 'health',
      label: 'Проверка',
      render: (credential) => HEALTH[credential.health ?? 'unknown'] ?? credential.health ?? '—',
    },
    {
      key: 'created_at',
      label: 'Добавлен',
      render: (credential) => formatDate(credential.created_at),
    },
    {
      key: 'actions',
      label: 'Действие',
      render: (credential) => (
        <Button
          size="sm"
          variant="danger"
          disabled={credential.status === 'disabled' || credential.status === 'expired'}
          onClick={() => askRemove(credential)}
        >
          Отключить
        </Button>
      ),
    },
  ]

  return (
    <section class="page providers-page">
      <PageHeader
        eyebrow="Кабинет"
        title="Поставщики"
        description="Возможности площадок и ваши ключи. Свой ключ снимает с Rox стоимость железа, остаётся сервисный сбор."
        actions={
          <Show when={!credentialsForbidden()}>
            <Button size="sm" variant="primary" onClick={openDialog}>
              Добавить ключ
            </Button>
          </Show>
        }
      />

      <Show when={failure()}>
        {(message) => (
          <div class="console-alert" role="alert">
            <span>Каталог поставщиков не загрузился: {message()}</span>
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Повторить
            </Button>
          </div>
        )}
      </Show>

      <Card title="Как это работает" subtitle="Пробный Daytona и свой ключ">
        <dl class="provider-modes">
          <div>
            <dt>
              <Badge tone="accent">Пробный · ключ Rox</Badge>
            </dt>
            <dd>
              Машина идёт на платформенном ключе Rox, вы платите полную цену с баланса. Так работает
              гостевой доступ и старт без аккаунта у поставщика. Ключ Rox никогда не покидает сервер.
            </dd>
          </div>
          <div>
            <dt>
              <Badge tone="success">Свой ключ</Badge>
            </dt>
            <dd>
              Железо вы платите поставщику напрямую, Rox берёт сервисный сбор 15 % от розничной цены, но
              не меньше 5 центов в час. Секрет шифруется и не показывается даже вам — только последние
              четыре символа.
            </dd>
          </div>
        </dl>
      </Card>

      <Show
        when={providers().length > 0}
        fallback={
          <Show
            when={loading()}
            fallback={
              <Show when={failure() === null}>
                <Card>
                  <EmptyState
                    icon="globe"
                    title="Поставщиков нет"
                    description="В этой сборке не подключён ни один поставщик песочниц: запускать машины не на чем."
                  />
                </Card>
              </Show>
            }
          >
            <div class="providers-grid" aria-live="polite">
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
          </Show>
        }
      >
        <div class="providers-grid">
          <For each={providers()}>
            {(capability) => (
              <article class="provider-card">
                <header class="provider-card-head">
                  <h2 class="provider-card-name">{capabilityLabel(capability)}</h2>
                  <Show when={managed().includes(capability.id)}>
                    <Badge tone="accent">Пробный · ключ Rox</Badge>
                  </Show>
                </header>
                <p class="provider-note">
                  {PROVIDER_NOTES[capability.id] ?? 'Поставщик из каталога Rox.'}
                </p>
                <dl class="provider-rows">
                  <div>
                    <dt>Системы</dt>
                    <dd>{capability.os !== undefined && capability.os.length > 0 ? capability.os.join(', ') : '—'}</dd>
                  </div>
                  <div>
                    <dt>Видеокарты</dt>
                    <dd>{hasGpu(capability) ? 'есть' : 'нет'}</dd>
                  </div>
                  <div>
                    <dt>Снимки</dt>
                    <dd>{capability.snapshot === true ? 'есть' : 'нет'}</dd>
                  </div>
                  <div>
                    <dt>Пауза</dt>
                    <dd>{capability.pause === true ? 'да' : 'нет'}</dd>
                  </div>
                  <div>
                    <dt>Срок</dt>
                    <dd>{ttlCap(capability)}</dd>
                  </div>
                  <div>
                    <dt>Площадки</dt>
                    <dd>
                      {capability.regions !== undefined && capability.regions.length > 0
                        ? capability.regions.join(', ')
                        : 'выбирает поставщик'}
                    </dd>
                  </div>
                </dl>
              </article>
            )}
          </For>
        </div>
      </Show>

      <Card
        title="Ваши ключи"
        subtitle="Последние четыре символа и потолок расходов; секрет хранится зашифрованным"
        flush
        actions={
          <Show when={!credentialsForbidden()}>
            <Button size="sm" variant="secondary" onClick={openDialog}>
              Добавить ключ
            </Button>
          </Show>
        }
      >
        <Show when={credentialsFailure() !== null && !credentialsForbidden()}>
          <div class="console-alert" role="alert">
            <span>Список ключей не загрузился: {credentialsFailure()}</span>
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Повторить
            </Button>
          </div>
        </Show>
        <Show
          when={!credentialsForbidden()}
          fallback={
            <EmptyState
              icon="shield"
              title="Ключи поставщиков недоступны"
              description={`${credentialsFailure() ?? 'Сервер отказал в доступе.'} ${
                session.guest()
                  ? 'Гостевой доступ не управляет ключами: он запускает машины на ключе Rox. Получите постоянный ключ у дежурного.'
                  : 'Этому ключу не выдано право keys:write.'
              }`}
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
            rows={credentials()}
            rowKey={(credential) => credential.id}
            label="Ключи поставщиков"
            loading={loading()}
            empty={
              <EmptyState
                icon="key"
                title="Своих ключей нет"
                description="Без своего ключа машины идут на ключе Rox по полной цене. Свой ключ Daytona снимает стоимость железа — остаётся сервисный сбор."
                action={
                  <Button variant="primary" onClick={openDialog}>
                    Добавить ключ
                  </Button>
                }
              />
            }
          />
        </Show>
      </Card>

      <Dialog
        open={open()}
        onClose={() => setOpen(false)}
        title="Добавить ключ поставщика"
        subtitle="Ключ шифруется на сервере и не показывается обратно"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button variant="primary" loading={saving()} onClick={() => void add()}>
              Добавить
            </Button>
          </>
        }
      >
        <Field label="Поставщик" for="provider-id">
          <Select
            id="provider-id"
            options={providerChoices()}
            value={provider()}
            onChange={(event) => setProvider(event.currentTarget.value)}
          />
        </Field>
        <Field
          label="Ключ поставщика"
          for="provider-secret"
          required
          hint="Вставьте ключ из панели поставщика. Он уйдёт на сервер один раз и вернётся только отпечатком."
        >
          <input
            id="provider-secret"
            class="input"
            type="password"
            value={secret()}
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            onInput={(event) => setSecret(event.currentTarget.value)}
          />
        </Field>
        <Field label="Название" for="provider-label" hint="Необязательно: чтобы отличать ключи одного поставщика.">
          <input
            id="provider-label"
            class="input"
            value={label()}
            placeholder="Мой Daytona"
            autocomplete="off"
            onInput={(event) => setLabel(event.currentTarget.value)}
          />
        </Field>
        <Field
          label="Потолок расходов, $"
          for="provider-cap"
          required
          hint="Сколько этот ключ разрешено потратить. Ноль означает «ничего не тратить»."
        >
          <input
            id="provider-cap"
            class="input"
            inputmode="decimal"
            value={capText()}
            autocomplete="off"
            onInput={(event) => setCapText(event.currentTarget.value)}
          />
        </Field>
        <Show when={formError()}>
          {(message) => (
            <div class="console-alert" role="alert">
              <span>{message()}</span>
            </div>
          )}
        </Show>
      </Dialog>

      <Dialog
        open={removing() !== null}
        onClose={closeRemove}
        title="Отключить ключ?"
        subtitle={removing() === null ? undefined : `•••• ${removing()?.last4}`}
        footer={
          <>
            <Button variant="ghost" onClick={closeRemove}>
              Отмена
            </Button>
            <Button variant="danger" loading={acting()} onClick={() => void remove()}>
              Отключить
            </Button>
          </>
        }
      >
        <Show when={removeError()}>
          {(message) => (
            <div class="console-alert" role="alert">
              <span>{message()}</span>
            </div>
          )}
        </Show>
        <p class="console-muted">
          Ключ перестанет использоваться: новые машины на нём не запустятся, а уже запущенные доживут до
          своего срока. Сам секрет останется зашифрованным на сервере, но вернуть ключ в работу нельзя —
          только добавить заново.
        </p>
      </Dialog>
    </section>
  )
}

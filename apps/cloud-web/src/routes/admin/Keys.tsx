import { A } from '@solidjs/router'
import { Show, createEffect, createMemo, createSignal, on } from 'solid-js'

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Money,
  PageHeader,
  Select,
  Table,
} from '@/components'
import type { SelectOption, TableColumn } from '@/components'
import { ApiError, api } from '@/lib/api'
import type { AdminKeyRow, ProviderCredential, Tenant } from '@/lib/api'
import { formatDate, shortId } from '@/lib/format'

import { AdminError } from './components/AdminError'
import {
  adminRefreshTick,
  credentialStatusLabel,
  credentialStatusTone,
  handleAdminError,
  keyHint,
  providerLabel,
} from './components/adminSession'

import './keys.css'

type KeyStateFilter = 'all' | 'active' | 'revoked'

const stateOptions: readonly SelectOption[] = [
  { value: 'all', label: 'Все ключи' },
  { value: 'active', label: 'Действуют' },
  { value: 'revoked', label: 'Отозваны' },
]

export default function AdminKeys() {
  const [keys, setKeys] = createSignal<AdminKeyRow[]>([])
  const [credentials, setCredentials] = createSignal<ProviderCredential[]>([])
  const [tenants, setTenants] = createSignal<Tenant[]>([])
  const [query, setQuery] = createSignal('')
  const [keyState, setKeyState] = createSignal<KeyStateFilter>('all')
  const [provider, setProvider] = createSignal('all')
  const [loading, setLoading] = createSignal(true)
  const [keysError, setKeysError] = createSignal<string | null>(null)
  const [credsError, setCredsError] = createSignal<string | null>(null)
  let generation = 0

  const tenantNames = createMemo(() => {
    const map: Record<string, string> = {}
    for (const tenant of tenants()) map[tenant.id] = tenant.name
    return map
  })

  const ownerName = (tenantId: string | null | undefined): string => {
    if (tenantId === null || tenantId === undefined || tenantId.length === 0) return '—'
    return tenantNames()[tenantId] ?? shortId(tenantId, 12)
  }

  const providerOptions = createMemo<SelectOption[]>(() => {
    const seen = new Set<string>()
    for (const credential of credentials()) seen.add(credential.provider)
    const rest = [...seen].sort().map((id) => ({ value: id, label: providerLabel(id) }))
    return [{ value: 'all', label: 'Все площадки' }, ...rest]
  })

  const visibleKeys = createMemo(() => {
    const needle = query().trim().toLowerCase()
    const state = keyState()
    return keys().filter((key) => {
      if (state === 'active' && key.revoked_at !== null && key.revoked_at !== undefined) return false
      if (state === 'revoked' && (key.revoked_at === null || key.revoked_at === undefined)) return false
      if (needle.length === 0) return true
      const name = key.tenant_name ?? tenantNames()[key.tenant_id] ?? ''
      const haystack = [
        name,
        key.tenant_id,
        key.prefix ?? '',
        key.last4,
        (key.scopes ?? []).join(' '),
      ]
      return haystack.some((value) => value.toLowerCase().includes(needle))
    })
  })

  const visibleCredentials = createMemo(() => {
    const needle = query().trim().toLowerCase()
    const chosen = provider()
    return credentials().filter((credential) => {
      if (chosen !== 'all' && credential.provider !== chosen) return false
      if (needle.length === 0) return true
      const tenantId = credential.tenant_id ?? ''
      const haystack = [
        tenantNames()[tenantId] ?? '',
        tenantId,
        credential.provider,
        credential.label,
        credential.fingerprint,
        credential.last4,
      ]
      return haystack.some((value) => value.toLowerCase().includes(needle))
    })
  })

  const keyColumns: readonly TableColumn<AdminKeyRow>[] = [
    {
      key: 'tenant_id',
      label: 'Владелец',
      render: (key) => (
        <span class="keys-owner">
          <span class="keys-owner-row">
            <A href={`/admin/clients/${encodeURIComponent(key.tenant_id)}`} class="strong">
              {ownerName(key.tenant_id)}
            </A>
            <Show when={key.guest === true}>
              <Badge tone="neutral">гость</Badge>
            </Show>
          </span>
          <span class="tiny muted mono keys-id" title={key.tenant_id}>
            {key.tenant_id}
          </span>
        </span>
      ),
    },
    {
      key: 'last4',
      label: 'Ключ',
      render: (key) => <span class="mono small keys-key">{keyHint(key.prefix, key.last4)}</span>,
    },
    {
      key: 'scopes',
      label: 'Области',
      render: (key) => <span class="tiny muted keys-scopes">{key.scopes?.join(', ') ?? '—'}</span>,
    },
    {
      key: 'balance_cents',
      label: 'Баланс владельца',
      align: 'right',
      render: (key) => <Money cents={key.balance_cents} />,
    },
    {
      key: 'reserved_cents',
      label: 'Резерв',
      align: 'right',
      render: (key) => <Money cents={key.reserved_cents} />,
    },
    {
      key: 'created_at',
      label: 'Создан',
      render: (key) => <span class="small">{formatDate(key.created_at)}</span>,
    },
    {
      key: 'state',
      label: 'Состояние',
      render: (key) => (
        <Show
          when={key.revoked_at ?? null}
          fallback={
            <Badge tone="success" dot>
              действует
            </Badge>
          }
        >
          {(revoked) => (
            <span class="keys-state">
              <Badge tone="danger">отозван</Badge>
              <span class="tiny muted">{formatDate(revoked())}</span>
            </span>
          )}
        </Show>
      ),
    },
    {
      key: 'last_used_at',
      label: 'Последний запрос',
      render: (key) => <span class="small">{formatDate(key.last_used_at)}</span>,
    },
  ]

  const credentialColumns: readonly TableColumn<ProviderCredential>[] = [
    {
      key: 'provider',
      label: 'Площадка',
      render: (credential) => <span class="strong">{providerLabel(credential.provider)}</span>,
    },
    {
      key: 'label',
      label: 'Ключ',
      render: (credential) => (
        <span class="keys-credential">
          <span class="small">{credential.label}</span>
          <span class="mono tiny muted">···· {credential.last4}</span>
        </span>
      ),
    },
    {
      key: 'fingerprint',
      label: 'Отпечаток',
      render: (credential) => (
        <span class="mono tiny keys-fingerprint" title={credential.fingerprint}>
          {credential.fingerprint}
        </span>
      ),
    },
    {
      key: 'tenant_id',
      label: 'Владелец',
      render: (credential) => (
        <span class="keys-owner">
          <Show
            when={credential.tenant_id}
            keyed
            fallback={<span class="strong">—</span>}
          >
            {(tenantId) => (
              <A href={`/admin/clients/${encodeURIComponent(tenantId)}`} class="strong">
                {ownerName(tenantId)}
              </A>
            )}
          </Show>
          <span class="tiny muted mono keys-id">{credential.tenant_id ?? '—'}</span>
        </span>
      ),
    },
    {
      key: 'created_at',
      label: 'Создан',
      render: (credential) => <span class="small">{formatDate(credential.created_at)}</span>,
    },
    {
      key: 'status',
      label: 'Состояние',
      render: (credential) => (
        <Badge tone={credentialStatusTone(credential.status)}>
          {credentialStatusLabel(credential.status)}
        </Badge>
      ),
    },
    {
      key: 'spend_cap_cents',
      label: 'Потолок расхода',
      align: 'right',
      render: (credential) => <Money cents={credential.spend_cap_cents} />,
    },
  ]

  async function load(): Promise<void> {
    const current = ++generation
    setLoading(true)
    setKeysError(null)
    setCredsError(null)
    const [keysResult, credentialsResult, tenantsResult] = await Promise.allSettled([
      api.admin.keys(),
      api.admin.credentials(),
      api.admin.tenants(),
    ])
    if (current !== generation) return
    if (keysResult.status === 'fulfilled') {
      setKeys(keysResult.value.data ?? [])
    } else {
      setKeys([])
      setKeysError(handleAdminError(keysResult.reason))
    }
    if (credentialsResult.status === 'fulfilled') {
      setCredentials(credentialsResult.value.data ?? [])
    } else {
      setCredentials([])
      setCredsError(handleAdminError(credentialsResult.reason))
    }
    if (tenantsResult.status === 'fulfilled') {
      setTenants(tenantsResult.value.data ?? [])
    } else {
      // Names are a convenience: without them the id is printed instead.
      setTenants([])
      if (tenantsResult.reason instanceof ApiError && tenantsResult.reason.status === 401) {
        handleAdminError(tenantsResult.reason)
      }
    }
    setLoading(false)
  }

  createEffect(on(adminRefreshTick, () => void load()))

  return (
    <section class="page keys-page">
      <PageHeader
        eyebrow="Ключи"
        title="Ключи клиентов и поставщиков"
        description="Клиентские ключи с балансом владельца и ключи поставщиков без секретов. Секретов здесь нет: сервер отдаёт только публичные части."
        actions={
          <Button size="sm" variant="secondary" onClick={() => void load()} loading={loading()}>
            Обновить
          </Button>
        }
      />

      <div class="keys-filters">
        <Field label="Поиск" for="keys-search">
          <input
            id="keys-search"
            class="input"
            type="search"
            autocomplete="off"
            spellcheck={false}
            placeholder="клиент, ключ, площадка"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </Field>
        <Field label="Клиентские ключи" for="keys-state">
          <Select
            id="keys-state"
            options={stateOptions}
            value={keyState()}
            onChange={(event) => setKeyState(event.currentTarget.value as KeyStateFilter)}
          />
        </Field>
        <Field label="Площадка" for="keys-provider">
          <Select
            id="keys-provider"
            options={providerOptions()}
            value={provider()}
            onChange={(event) => setProvider(event.currentTarget.value)}
          />
        </Field>
      </div>

      <Card
        title="Ключи клиентов"
        subtitle="Секрет показывается один раз при выдаче; в списке остаются начало и последние четыре символа."
      >
        <AdminError text={keysError()} onRetry={() => void load()} />
        <Table
          label="Ключи клиентов"
          columns={keyColumns}
          rows={visibleKeys()}
          rowKey={(key) => key.id}
          loading={loading()}
          empty={
            <Show
              when={keys().length === 0}
              fallback={
                <EmptyState
                  icon="key"
                  title="Ничего не найдено"
                  description="Измените поиск или состояние ключа."
                />
              }
            >
              <EmptyState
                icon="key"
                title="Ключей пока нет"
                description="Первый ключ появится, когда клиент войдёт в кабинет гостем или получит ключ от дежурного."
              />
            </Show>
          }
        />
        <p class="tiny muted keys-hint">
          Отозванные ключи остаются в списке: так видно, что перевыпуск заменил старый ключ.
        </p>
      </Card>

      <Card
        title="Ключи поставщиков"
        subtitle="Свои ключи клиентов у внешних площадок. Площадку, отпечаток и владельца видно, секрет — нет."
      >
        <div class="keys-note" role="note">
          <span class="strong">Баланс аккаунта у поставщика здесь не виден.</span>
          <span>
            API Rox не отдаёт остаток на счёте у Daytona или другой площадки — только площадку,
            отпечаток, последние четыре символа, владельца и дату создания. Баланс смотрите в личном
            кабинете поставщика.
          </span>
        </div>
        <AdminError text={credsError()} onRetry={() => void load()} />
        <Table
          label="Ключи поставщиков"
          columns={credentialColumns}
          rows={visibleCredentials()}
          rowKey={(credential) => credential.id}
          loading={loading()}
          empty={
            <Show
              when={credentials().length === 0}
              fallback={
                <EmptyState
                  icon="globe"
                  title="Ничего не найдено"
                  description="Измените поиск или выберите другую площадку."
                />
              }
            >
              <EmptyState
                icon="globe"
                title="Ключей поставщиков нет"
                description="Клиенты ещё не добавляли свои ключи. Машины идут на ключе Rox."
              />
            </Show>
          }
        />
      </Card>
    </section>
  )
}

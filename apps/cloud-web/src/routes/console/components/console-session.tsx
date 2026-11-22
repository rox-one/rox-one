/**
 * One session for the whole console: how the tab got its key, what the wallet
 * holds, and the only place that turns «Пополнить» into a real request.
 *
 * The key never enters the address bar, a cookie, `localStorage` or a log. A
 * guest arrival (`?guest=1`) is exchanged for a trial key exactly once, then
 * the flag is removed from the address so a reload does not mint a second
 * guest. When the API refuses the trial, the form and the server's own words
 * are shown — never a pretend success.
 */
import { useNavigate } from '@solidjs/router'
import { Show, createContext, createSignal, onMount, useContext } from 'solid-js'
import type { Accessor, JSX } from 'solid-js'

import { Button, Dialog, useToast } from '@/components'
import { api, ApiError } from '@/lib/api'
import type { Account } from '@/lib/api'
import { formatCents, shortId } from '@/lib/format'
import { clearClientKey, getClientKey, setClientKey } from '@/lib/session'

export type ConsolePhase = 'boot' | 'welcome' | 'ready'

/** A refusal a person reads above the key form: words, code and request id. */
export interface ConsoleNotice {
  text: string
  code: string | null
  requestId: string | null
}

export interface ConsoleSessionApi {
  phase: Accessor<ConsolePhase>
  /** The wallet, once it has loaded; `undefined` while unknown. */
  account: Accessor<Account | undefined>
  accountLoading: Accessor<boolean>
  /** A non-auth failure of `/v1/account`: the tab is open, the balance is not. */
  accountError: Accessor<ApiError | null>
  guest: Accessor<boolean>
  guestName: Accessor<string>
  /** A guest sign-up or a key sign-in is in flight. */
  busy: Accessor<boolean>
  notice: Accessor<ConsoleNotice | null>
  /** Returns a message for the key form, or `null` when the key was accepted. */
  signIn: (key: string) => Promise<string | null>
  tryGuest: () => Promise<void>
  signOut: () => void
  refreshAccount: () => Promise<void>
  openTopUp: () => void
}

const ConsoleSessionContext = createContext<ConsoleSessionApi | undefined>(undefined)

const GUEST_FLAG = 'rox_console_guest'
const GUEST_NAME = 'rox_console_guest_name'

function readStored(name: string): string {
  try {
    return sessionStorage.getItem(name) ?? ''
  } catch {
    return ''
  }
}

function writeStored(name: string, value: string): void {
  try {
    if (value.length === 0) sessionStorage.removeItem(name)
    else sessionStorage.setItem(name, value)
  } catch {
    /* private mode: the tab simply forgets */
  }
}

function asApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  const message = err instanceof Error ? err.message : String(err)
  return new ApiError(0, 'client_error', message)
}

function noticeFor(err: unknown, prefix: string): ConsoleNotice {
  const failure = asApiError(err)
  return {
    text: `${prefix}: ${failure.message}`,
    code: failure.code,
    requestId: failure.requestId,
  }
}

function wantsGuest(): boolean {
  return new URL(location.href).searchParams.get('guest') === '1'
}

/** Drop `guest` from the address while keeping `?plan=` and the current path. */
function stripGuestParam(): void {
  const url = new URL(location.href)
  if (!url.searchParams.has('guest')) return
  url.searchParams.delete('guest')
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

/** The name a topbar can print without inventing one the API never sent. */
export function accountLabel(account: Account | undefined, guest: boolean, guestName: string): string {
  if (guest) return guestName.length > 0 ? guestName : 'Гость'
  if (account !== undefined) {
    const direct = account['tenant_name']
    if (typeof direct === 'string' && direct.length > 0) return direct
    const nested = account['tenant']
    if (nested !== null && typeof nested === 'object' && 'name' in nested) {
      const name = nested.name
      if (typeof name === 'string' && name.length > 0) return name
    }
    const own = account['name']
    if (typeof own === 'string' && own.length > 0) return own
  }
  return 'Клиент Rox'
}

export function ConsoleSessionProvider(props: { children?: JSX.Element }): JSX.Element {
  const navigate = useNavigate()
  const toast = useToast()

  const [phase, setPhase] = createSignal<ConsolePhase>('boot')
  const [account, setAccount] = createSignal<Account | undefined>(undefined)
  const [accountLoading, setAccountLoading] = createSignal(false)
  const [accountError, setAccountError] = createSignal<ApiError | null>(null)
  const [guest, setGuest] = createSignal(readStored(GUEST_FLAG) === '1')
  const [guestName, setGuestName] = createSignal(readStored(GUEST_NAME))
  const [busy, setBusy] = createSignal(false)
  const [notice, setNotice] = createSignal<ConsoleNotice | null>(null)
  const [topUpOpen, setTopUpOpen] = createSignal(false)

  async function loadAccount(): Promise<ApiError | null> {
    setAccountLoading(true)
    try {
      const next = await api.account()
      setAccount(next)
      setAccountError(null)
      setPhase('ready')
      return null
    } catch (err) {
      const failure = asApiError(err)
      if (failure.isAuthError) {
        // A revoked or mistyped key is not a session: go back to the door.
        clearClientKey()
        setAccount(undefined)
        setPhase('welcome')
        setNotice({
          text: `Ключ не подошёл: ${failure.message}`,
          code: failure.code,
          requestId: failure.requestId,
        })
      } else {
        setAccountError(failure)
        setPhase('ready')
      }
      return failure
    } finally {
      setAccountLoading(false)
    }
  }

  async function startGuest(): Promise<void> {
    setBusy(true)
    setNotice(null)
    try {
      const session = await api.guest()
      setClientKey(session.api_key)
      writeStored(GUEST_FLAG, '1')
      writeStored(GUEST_NAME, session.tenant.name)
      setGuest(true)
      setGuestName(session.tenant.name)
      stripGuestParam()
      await loadAccount()
    } catch (err) {
      // `guest_disabled`, `rate_limited` or a network failure: the server's own
      // explanation, above the key form. No key is written, no flag is set.
      setNotice(noticeFor(err, 'Гостевой вход недоступен'))
      setPhase('welcome')
    } finally {
      setBusy(false)
    }
  }

  async function signIn(key: string): Promise<string | null> {
    const trimmed = key.trim()
    if (trimmed.length === 0) return 'Введите ключ API'
    setBusy(true)
    setNotice(null)
    setClientKey(trimmed)
    writeStored(GUEST_FLAG, '')
    writeStored(GUEST_NAME, '')
    setGuest(false)
    setGuestName('')
    stripGuestParam()
    try {
      const failure = await loadAccount()
      if (failure === null || !failure.isAuthError) return null
      // The form shows the refusal; the card-wide notice would repeat it.
      setNotice(null)
      return `Ключ не подошёл: ${failure.message}`
    } finally {
      setBusy(false)
    }
  }

  function signOut(): void {
    clearClientKey()
    writeStored(GUEST_FLAG, '')
    writeStored(GUEST_NAME, '')
    setGuest(false)
    setGuestName('')
    setAccount(undefined)
    setAccountError(null)
    setNotice(null)
    setTopUpOpen(false)
    setPhase('welcome')
    navigate('/console', { replace: true })
  }

  onMount(() => {
    if (getClientKey().length > 0) {
      // A key wins over the guest flag; the address should not keep both.
      stripGuestParam()
      void loadAccount()
      return
    }
    // A guest flag without a key is stale: both live and die together.
    if (readStored(GUEST_FLAG) === '1') writeStored(GUEST_FLAG, '')
    if (wantsGuest()) {
      void startGuest()
      return
    }
    setPhase('welcome')
  })

  const apiValue: ConsoleSessionApi = {
    phase,
    account,
    accountLoading,
    accountError,
    guest,
    guestName,
    busy,
    notice,
    signIn,
    tryGuest: startGuest,
    signOut,
    refreshAccount: async () => {
      await loadAccount()
    },
    openTopUp: () => setTopUpOpen(true),
  }

  return (
    <ConsoleSessionContext.Provider value={apiValue}>
      {props.children}
      <TopUpDialog
        open={topUpOpen()}
        onClose={() => setTopUpOpen(false)}
        balanceCents={account()?.balance_cents}
        onSent={(id) => toast.success(`Обращение отправлено: ${shortId(id)}`)}
      />
    </ConsoleSessionContext.Provider>
  )
}

export function useConsoleSession(): ConsoleSessionApi {
  const value = useContext(ConsoleSessionContext)
  if (value === undefined) throw new Error('useConsoleSession вызван вне ConsoleSessionProvider')
  return value
}

/**
 * There is no card capture in this slice, so «Пополнить» does the honest thing:
 * explains who can credit the wallet and opens a support ticket that the duty
 * officer answers in the same console.
 */
function TopUpDialog(props: {
  open: boolean
  onClose: () => void
  balanceCents: number | undefined
  onSent: (id: string) => void
}): JSX.Element {
  const [state, setState] = createSignal<'idle' | 'sending' | 'sent'>('idle')
  const [ticketId, setTicketId] = createSignal('')
  const [failure, setFailure] = createSignal<ConsoleNotice | null>(null)

  const reset = (): void => {
    setState('idle')
    setTicketId('')
    setFailure(null)
  }

  const send = async (): Promise<void> => {
    setState('sending')
    setFailure(null)
    const balanceLine = props.balanceCents === undefined ? null : formatCents(props.balanceCents)
    try {
      const ticket = await api.request<{ id: string }>('/v1/tickets', {
        method: 'POST',
        body: {
          subject: 'Пополнение баланса',
          body: `Прошу пополнить баланс кабинета Rox Cloud.${
            balanceLine === null ? '' : ` Сейчас на счёте ${balanceLine}.`
          }`,
          priority: 'normal',
        },
      })
      setTicketId(ticket.id)
      setState('sent')
      props.onSent(ticket.id)
    } catch (err) {
      setFailure(noticeFor(err, 'Обращение не отправилось'))
      setState('idle')
    }
  }

  return (
    <Dialog
      open={props.open}
      onClose={() => {
        reset()
        props.onClose()
      }}
      title="Пополнить баланс"
      subtitle="Карты в этой версии не принимаются"
      footer={
        <Show
          when={state() === 'sent'}
          fallback={
            <>
              <Button variant="ghost" onClick={() => props.onClose()}>
                Закрыть
              </Button>
              <Button variant="primary" loading={state() === 'sending'} onClick={() => void send()}>
                Написать дежурному
              </Button>
            </>
          }
        >
          <Button
            variant="primary"
            onClick={() => {
              reset()
              props.onClose()
            }}
          >
            Понятно
          </Button>
        </Show>
      }
    >
      <Show
        when={state() === 'sent'}
        fallback={
          <>
            <p class="console-muted">
              Пополнение делает дежурный: он начисляет сумму на счёт и отвечает в кабинете. Нажмите
              «Написать дежурному» — откроется обращение с текущим остатком, ничего вводить не нужно.
            </p>
            <p class="console-muted small">
              {props.balanceCents === undefined
                ? 'Баланс ещё не загружен.'
                : `Сейчас на счёте ${formatCents(props.balanceCents)}.`}{' '}
              Пока баланса не хватает, машины не запускаются: резерв за срок жизни не помещается в
              остаток.
            </p>
            <Show when={failure() !== null}>
              <div class="console-alert" role="alert">
                <span>{failure()?.text}</span>
                <Show when={(failure()?.code ?? null) !== null || (failure()?.requestId ?? null) !== null}>
                  <span class="console-alert-meta">
                    {[
                      failure()?.code ?? null,
                      failure()?.requestId === null || failure()?.requestId === undefined
                        ? null
                        : `запрос ${failure()?.requestId}`,
                    ]
                      .filter((part) => part !== null)
                      .join(' · ')}
                  </span>
                </Show>
              </div>
            </Show>
          </>
        }
      >
        <p class="console-muted">
          Обращение отправлено. Номер {shortId(ticketId(), 10)} — дежурный ответит на него, ответ
          появится у него в очереди поддержки.
        </p>
      </Show>
    </Dialog>
  )
}

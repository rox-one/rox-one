import { A } from '@solidjs/router'
import type { RouteSectionProps } from '@solidjs/router'
import { For, Show, Suspense, createEffect, createSignal, untrack } from 'solid-js'
import type { JSX } from 'solid-js'

import { Badge, Button, Icon, Presence, Skeleton } from '@/components'
import type { IconName } from '@/components'
import { formatCents } from '@/lib/format'
import { reveal } from '@/lib/motion'

import { ConsoleSessionProvider, accountLabel, useConsoleSession } from './components/console-session'
import { ConsoleWelcome } from './components/Welcome'

import './console.css'

/**
 * The customer sections. Provider credentials are staff bookkeeping, not a
 * customer task, so the console does not name a provider anywhere.
 */
const links: readonly { href: string; label: string; icon: IconName; end?: boolean }[] = [
  { href: '/console', label: 'Продукты', icon: 'box', end: true },
  { href: '/console/machines', label: 'Машины', icon: 'server' },
  { href: '/console/invoice', label: 'Счёт', icon: 'chart' },
  { href: '/console/keys', label: 'Ключи', icon: 'key' },
  { href: '/console/journal', label: 'Журнал', icon: 'log' },
]

/** A layout preference, not a secret: it may outlive the tab. */
const NAV_STORAGE_KEY = 'rox.console.nav'

function readNavCollapsed(): boolean {
  try {
    return window.localStorage.getItem(NAV_STORAGE_KEY) === 'collapsed'
  } catch {
    return false
  }
}

function writeNavCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(NAV_STORAGE_KEY, 'collapsed')
    else window.localStorage.removeItem(NAV_STORAGE_KEY)
  } catch {
    /* private mode: the choice lasts for this visit only */
  }
}

/**
 * The console chrome: the key door, the sections, and the wallet that every
 * page reads through one context. A tab without a key sees the welcome card;
 * a key that the API rejects goes back there with the server's own words.
 */
export default function ConsoleLayout(props: RouteSectionProps) {
  return (
    <ConsoleSessionProvider>
      <ConsoleSurface>{props.children}</ConsoleSurface>
    </ConsoleSessionProvider>
  )
}

function ConsoleSurface(props: { children?: JSX.Element }) {
  const session = useConsoleSession()
  return (
    <Show
      when={session.phase() === 'welcome'}
      fallback={
        <ConsoleFrame booting={session.phase() === 'boot'}>{props.children}</ConsoleFrame>
      }
    >
      <ConsoleWelcome />
    </Show>
  )
}

function ConsoleFrame(props: { children?: JSX.Element; booting: boolean }) {
  const session = useConsoleSession()
  const reserved = (): number => session.account()?.reserved_cents ?? 0
  const [collapsed, setCollapsed] = createSignal(readNavCollapsed())

  // Only after the account is known: one reveal of the content column, then
  // navigation inside the console never replays it.
  let content: HTMLElement | undefined
  let revealed = false
  createEffect(() => {
    if (revealed || session.phase() !== 'ready') return
    const host = content
    if (host === undefined) return
    revealed = true
    reveal(host)
  })

  // The balance alert stays through its own fade: the message is copied here,
  // so a server answer that clears the error still has something to fade out.
  const [alert, setAlert] = createSignal<{ message: string; requestId: string | null } | null>(null)
  const [alertLeaving, setAlertLeaving] = createSignal(false)
  createEffect(() => {
    const error = session.accountError()
    if (error !== null) {
      setAlert({ message: error.message, requestId: error.requestId })
      setAlertLeaving(false)
      return
    }
    if (untrack(alert) !== null) setAlertLeaving(true)
  })

  return (
    <div class={`app-shell console-shell${collapsed() ? ' is-nav-collapsed' : ''}`}>
      <aside class="app-nav console-nav" aria-label="Боковое меню кабинета">
        <div class="console-nav-head">
          <A href="/console" class="app-brand console-brand" end title="Rox Cloud" aria-label="Rox Cloud">
            <span class="app-brand-mark" aria-hidden="true">
              R
            </span>
            <span class="console-brand-text">Rox Cloud</span>
          </A>
          <button
            type="button"
            class="console-nav-toggle"
            onClick={() => {
              const next = !collapsed()
              setCollapsed(next)
              writeNavCollapsed(next)
            }}
            aria-expanded={!collapsed()}
            aria-controls="console-nav-links"
            aria-label={collapsed() ? 'Развернуть меню' : 'Свернуть меню'}
            title={collapsed() ? 'Развернуть меню' : 'Свернуть меню'}
          >
            <Icon name="arrow" size={14} />
          </button>
        </div>
        <nav id="console-nav-links" class="app-nav-links" aria-label="Разделы кабинета">
          <For each={links}>
            {(link) => (
              <A
                href={link.href}
                end={link.end}
                activeClass="is-active"
                title={collapsed() ? link.label : undefined}
              >
                <Icon name={link.icon} size={16} />
                <span class={collapsed() ? 'console-nav-label sr-only' : 'console-nav-label'}>
                  {link.label}
                </span>
              </A>
            )}
          </For>
        </nav>
        <div class="app-nav-foot console-nav-foot">
          <span>Ключ живёт только в этой вкладке</span>
          <A href="/">На сайт</A>
        </div>
      </aside>

      <div class="app-main">
        <header class="app-topbar console-topbar">
          <div class="console-topbar-id">
            <span class="app-topbar-title">Кабинет</span>
            <span class="console-tenant" title="Название клиента">
              {accountLabel(session.account(), session.guest(), session.guestName())}
            </span>
            <Show when={session.guest()}>
              <Badge tone="accent" dot>
                Пробный доступ
              </Badge>
            </Show>
          </div>
          <div class="app-topbar-actions">
            <div class="console-balance" aria-live="polite">
              <span class="console-balance-label">Баланс</span>
              <Show
                when={session.account() !== undefined}
                fallback={
                  <span class="console-balance-value">
                    {session.accountLoading() ? '…' : 'не загружен'}
                  </span>
                }
              >
                <span class="console-balance-value">{formatCents(session.account()?.balance_cents)}</span>
              </Show>
              <Show when={reserved() > 0}>
                <span class="console-balance-note">в резерве {formatCents(reserved())}</span>
              </Show>
            </div>
            <Button size="sm" variant="secondary" onClick={() => session.openTopUp()}>
              Пополнить
            </Button>
            <Button size="sm" variant="ghost" onClick={() => session.signOut()}>
              Выйти
            </Button>
            <A href="/" class="btn btn-ghost btn-sm">
              На сайт
            </A>
          </div>
        </header>

        <Show when={alert()}>
          {(notice) => (
            <Presence
              exiting={alertLeaving()}
              onExitEnd={() => {
                setAlert(null)
                setAlertLeaving(false)
              }}
            >
              <div class="console-alert console-alert-top" role="alert">
                <span>
                  Счёт не загрузился: {notice().message}
                  {notice().requestId === null ? '' : ` (запрос ${notice().requestId})`}
                </span>
                <Button size="sm" variant="secondary" onClick={() => void session.refreshAccount()}>
                  Повторить
                </Button>
              </div>
            </Presence>
          )}
        </Show>

        <main class="app-content" ref={content}>
          <Suspense
            fallback={
              <div class="console-loading" aria-live="polite">
                <span class="sr-only">Загружаем страницу</span>
                <Skeleton lines={5} />
              </div>
            }
          >
            <Show
              when={!props.booting}
              fallback={
                <div class="console-boot" aria-live="polite">
                  <span class="sr-only">Открываем кабинет</span>
                  <Skeleton lines={4} />
                </div>
              }
            >
              {props.children}
            </Show>
          </Suspense>
        </main>
      </div>
    </div>
  )
}

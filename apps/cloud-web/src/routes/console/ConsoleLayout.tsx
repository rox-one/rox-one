import { A } from '@solidjs/router'
import type { RouteSectionProps } from '@solidjs/router'
import { For, Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { Badge, Button, Icon, Skeleton } from '@/components'
import type { IconName } from '@/components'
import { formatCents } from '@/lib/format'

import { ConsoleSessionProvider, accountLabel, useConsoleSession } from './components/console-session'
import { ConsoleWelcome } from './components/Welcome'

import './console.css'

const links: readonly { href: string; label: string; icon: IconName; end?: boolean }[] = [
  { href: '/console', label: 'Продукты', icon: 'box', end: true },
  { href: '/console/machines', label: 'Машины', icon: 'server' },
  { href: '/console/invoice', label: 'Счёт', icon: 'chart' },
  { href: '/console/keys', label: 'Ключи', icon: 'key' },
  { href: '/console/providers', label: 'Поставщики', icon: 'globe' },
  { href: '/console/journal', label: 'Журнал', icon: 'log' },
]

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
      when={session.phase() === 'ready'}
      fallback={
        <Show
          when={session.phase() === 'welcome'}
          fallback={
            <div class="boot console-boot" aria-live="polite">
              <span class="sr-only">Открываем кабинет</span>
              <Skeleton lines={4} />
            </div>
          }
        >
          <ConsoleWelcome />
        </Show>
      }
    >
      <ConsoleFrame>{props.children}</ConsoleFrame>
    </Show>
  )
}

function ConsoleFrame(props: { children?: JSX.Element }) {
  const session = useConsoleSession()
  const reserved = (): number => session.account()?.reserved_cents ?? 0

  return (
    <div class="app-shell console-shell">
      <aside class="app-nav">
        <A href="/console" class="app-brand" end>
          <span class="app-brand-mark" aria-hidden="true">
            R
          </span>
          Rox Cloud
        </A>
        <nav class="app-nav-links" aria-label="Разделы кабинета">
          <For each={links}>
            {(link) => (
              <A href={link.href} end={link.end} activeClass="is-active">
                <Icon name={link.icon} size={16} />
                {link.label}
              </A>
            )}
          </For>
        </nav>
        <div class="app-nav-foot">
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

        <Show when={session.accountError()}>
          {(error) => (
            <div class="console-alert console-alert-top" role="alert">
              <span>
                Счёт не загрузился: {error().message}
                {error().requestId === null ? '' : ` (запрос ${error().requestId})`}
              </span>
              <Button size="sm" variant="secondary" onClick={() => void session.refreshAccount()}>
                Повторить
              </Button>
            </div>
          )}
        </Show>

        <main class="app-content">{props.children}</main>
      </div>
    </div>
  )
}

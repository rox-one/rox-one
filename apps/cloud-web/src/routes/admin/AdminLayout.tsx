import { A, useLocation } from '@solidjs/router'
import type { RouteSectionProps } from '@solidjs/router'
import { For, Show, createEffect, createSignal, on, onCleanup, onMount } from 'solid-js'

import { Button, Field, Icon } from '@/components'
import type { IconName } from '@/components'
import { ApiError, api } from '@/lib/api'
import { clearAdminKey, getAdminKey, getStaffName, setAdminKey } from '@/lib/session'

import {
  acceptStaffSession,
  adminAuthNote,
  adminAuthorized,
  adminErrorText,
  adminStaffName,
  forgetStaffSession,
  markUnauthorized,
  requestAdminRefresh,
} from './components/adminSession'

import './admin.css'

interface NavLink {
  href: string
  label: string
  icon: IconName
  end?: boolean
}

/** The sidebar keeps access and operations apart; the same split on a phone. */
const groups: readonly { title: string; links: readonly NavLink[] }[] = [
  {
    title: 'Работа',
    links: [
      { href: '/admin', label: 'Обзор', icon: 'chart', end: true },
      { href: '/admin/clients', label: 'Клиенты', icon: 'users' },
      { href: '/admin/keys', label: 'Ключи', icon: 'key' },
    ],
  },
  {
    title: 'Эксплуатация',
    links: [
      { href: '/admin/machines', label: 'Машины', icon: 'server' },
      { href: '/admin/logs', label: 'Журналы', icon: 'log' },
      { href: '/admin/support', label: 'Поддержка', icon: 'shield' },
      { href: '/admin/security', label: 'Безопасность', icon: 'stop' },
    ],
  },
]

/**
 * The panel's chrome and its only door.
 *
 * Without a key in this tab the pages are not mounted at all; the layout shows
 * the key form instead. A stored key is checked quietly on load, on every
 * route change and once a minute, so a key rotated by a colleague puts the
 * form back even on a page that is not fetching anything right now.
 */
export default function AdminLayout(props: RouteSectionProps) {
  const location = useLocation()
  const [keyInput, setKeyInput] = createSignal('')
  const [staffInput, setStaffInput] = createSignal(getStaffName())
  const [busy, setBusy] = createSignal(false)
  const [formError, setFormError] = createSignal<string | null>(null)
  let keyField: HTMLInputElement | undefined

  const shownNote = (): { message: string; requestId: string | null } | null => {
    const fromForm = formError()
    if (fromForm !== null) return { message: fromForm, requestId: null }
    return adminAuthNote()
  }

  createEffect(() => {
    if (!adminAuthorized() && keyField !== undefined) keyField.focus()
  })

  async function verifyKey(): Promise<void> {
    if (!adminAuthorized()) return
    try {
      await api.admin.overview()
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) markUnauthorized(error)
    }
  }

  async function signIn(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (busy()) return
    const key = keyInput().trim()
    if (key.length === 0) {
      setFormError('Введите ключ дежурного.')
      return
    }
    setBusy(true)
    setFormError(null)
    setAdminKey(key)
    if (getAdminKey() !== key) {
      setBusy(false)
      setFormError('Браузер не разрешает этой вкладке хранить ключ. Откройте обычное окно, не приватное.')
      return
    }
    try {
      // The key is only remembered after the server accepts it, so a typo
      // never leaves the panel half-open.
      await api.admin.overview()
      acceptStaffSession(key, staffInput())
      setKeyInput('')
    } catch (error) {
      clearAdminKey()
      setFormError(
        error instanceof ApiError && error.status === 401 ? error.toString() : adminErrorText(error),
      )
    } finally {
      setBusy(false)
    }
  }

  onMount(() => {
    void verifyKey()
    const timer = setInterval(() => void verifyKey(), 90_000)
    onCleanup(() => clearInterval(timer))
  })

  function signOut(): void {
    forgetStaffSession()
    setKeyInput('')
    setStaffInput('')
    setFormError(null)
  }

  createEffect(
    on(
      () => location.pathname,
      () => void verifyKey(),
      { defer: true },
    ),
  )

  return (
    <Show
      when={adminAuthorized()}
      fallback={
        <div class="admin-login">
          <form
            class="admin-login-card"
            onSubmit={(event) => void signIn(event)}
            novalidate
          >
            <div class="admin-login-brand">
              <span class="app-brand-mark" aria-hidden="true">
                R
              </span>
              <span>Rox Cloud · панель дежурного</span>
            </div>
            <div class="admin-login-intro">
              <h1>Вход по ключу</h1>
              <p class="admin-login-lead">
                Ключ дежурного выдаёт администратор сервера. Он живёт только в этой вкладке и исчезает,
                когда вы её закроете. В адресной строке ключа нет.
              </p>
            </div>
            <Show when={shownNote()}>
              {(note) => (
                <div class="admin-alert" role="alert">
                  <span>{note().message}</span>
                  <Show when={note().requestId !== null}>
                    <span class="admin-alert-meta">запрос {note().requestId}</span>
                  </Show>
                </div>
              )}
            </Show>
            <Field label="Ключ дежурного" for="admin-key" required>
              <input
                ref={(element) => {
                  keyField = element
                }}
                id="admin-key"
                class="input"
                type="password"
                autocomplete="off"
                spellcheck={false}
                placeholder="ключ дежурного"
                value={keyInput()}
                onInput={(event) => {
                  setKeyInput(event.currentTarget.value)
                  setFormError(null)
                }}
              />
            </Field>
            <Field
              label="Имя дежурного"
              for="admin-staff"
              hint="Видно в шапке панели; подпись необязательна."
            >
              <input
                id="admin-staff"
                class="input"
                type="text"
                autocomplete="off"
                spellcheck={false}
                maxlength={60}
                placeholder="например, анна"
                value={staffInput()}
                onInput={(event) => setStaffInput(event.currentTarget.value)}
              />
            </Field>
            <Button type="submit" variant="primary" block loading={busy()}>
              Войти
            </Button>
            <div class="admin-login-foot">
              <A href="/console">В кабинет</A>
              <A href="/">На сайт</A>
            </div>
          </form>
        </div>
      }
    >
      <div class="app-shell admin-shell">
        <a class="skip-link" href="#admin-content">
          К содержанию
        </a>
        <aside class="app-nav">
          <A href="/admin" class="app-brand" end>
            <span class="app-brand-mark" aria-hidden="true">
              R
            </span>
            Панель
          </A>
          <For each={groups}>
            {(group) => (
              <div class="admin-nav-group">
                <div class="app-nav-section">{group.title}</div>
                <nav class="app-nav-links" aria-label={group.title}>
                  <For each={group.links}>
                    {(link) => (
                      <A href={link.href} end={link.end} activeClass="is-active">
                        <Icon name={link.icon} size={16} />
                        {link.label}
                      </A>
                    )}
                  </For>
                </nav>
              </div>
            )}
          </For>
          <div class="app-nav-foot">
            <A href="/console">← В кабинет</A>
            <A href="/">На сайт</A>
          </div>
        </aside>
        <div class="app-main">
          <header class="app-topbar admin-topbar">
            <div class="admin-topbar-staff">
              <span class="app-topbar-title">Панель дежурного</span>
              <span class="admin-staff-name">{adminStaffName() || 'дежурный'}</span>
            </div>
            <div class="app-topbar-actions">
              <Button size="sm" variant="secondary" onClick={requestAdminRefresh}>
                Обновить
              </Button>
              <Button size="sm" variant="ghost" onClick={signOut}>
                Выйти
              </Button>
            </div>
          </header>
          <main class="app-content" id="admin-content">
            {props.children}
          </main>
        </div>
      </div>
    </Show>
  )
}

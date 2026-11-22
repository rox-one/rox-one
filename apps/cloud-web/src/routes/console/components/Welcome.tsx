import { A } from '@solidjs/router'
import { For, Show, createSignal } from 'solid-js'
import type { JSX } from 'solid-js'

import { Badge, Button, Field, Icon } from '@/components'

import { useConsoleSession } from './console-session'

const TRIAL_POINTS: readonly string[] = [
  '20,00 $ на счёт сразу',
  'Одна машина одновременно',
  'Срок жизни до 24 часов',
]

/**
 * The door of the console: a trial without registration, or a key a person
 * already has. Every refusal stays on this screen in the server's own words,
 * and the key input is a password field that is never echoed.
 */
export function ConsoleWelcome(): JSX.Element {
  const session = useConsoleSession()
  const [key, setKey] = createSignal('')
  const [formError, setFormError] = createSignal<string | null>(null)

  const submit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault()
    setFormError(null)
    const message = await session.signIn(key())
    if (message !== null) setFormError(message)
    else setKey('')
  }

  return (
    <div class="console-door">
      <header class="console-door-top">
        <A href="/" class="console-door-brand">
          <span class="app-brand-mark" aria-hidden="true">
            R
          </span>
          Rox Cloud
        </A>
        <nav class="console-door-links" aria-label="Переходы">
          <A href="/pricing">Продукты и цены</A>
          <A href="/docs">Документация</A>
          <A href="/">На сайт</A>
        </nav>
      </header>

      <main class="console-door-main">
        <section class="console-door-card" aria-labelledby="console-door-title">
          <div class="console-door-eyebrow">Кабинет</div>
          <h1 class="console-door-title" id="console-door-title">
            Машина за минуту
          </h1>
          <p class="console-door-lede">
            Соберите состав на одном экране, запустите машину и работайте в терминале браузера. Цена и
            резерв видны до запуска.
          </p>

          <Show when={session.notice()}>
            {(notice) => (
              <div class="console-alert" role="alert">
                <span>{notice().text}</span>
                <Show when={notice().requestId !== null || notice().code !== null}>
                  <span class="console-alert-meta">
                    {[notice().code, notice().requestId === null ? null : `запрос ${notice().requestId}`]
                      .filter((part) => part !== null && part.length > 0)
                      .join(' · ')}
                  </span>
                </Show>
              </div>
            )}
          </Show>

          <div class="console-door-trial">
            <div class="console-door-trial-head">
              <Badge tone="accent">Пробный доступ</Badge>
              <span class="console-muted small">без почты и карты</span>
            </div>
            <ul class="console-door-points">
              <For each={TRIAL_POINTS}>
                {(point) => (
                  <li>
                    <Icon name="check" size={13} />
                    {point}
                  </li>
                )}
              </For>
            </ul>
            <Button
              variant="primary"
              size="lg"
              block
              loading={session.busy()}
              onClick={() => void session.tryGuest()}
            >
              Попробовать без регистрации
            </Button>
            <p class="console-door-hint">
              Ключ создаётся один раз и живёт только в этой вкладке. Позже его не восстановить — так и
              задумано.
            </p>
          </div>

          <div class="console-door-sep" aria-hidden="true">
            <span>или</span>
          </div>

          <form class="console-door-form" onSubmit={(event) => void submit(event)}>
            <Field
              label="Ключ API"
              for="console-door-key"
              hint="Ключ вида rox_sk_live_… — от дежурного или из прошлой вкладки."
              error={formError()}
            >
              <input
                id="console-door-key"
                class="input"
                type="password"
                value={key()}
                placeholder="rox_sk_live_…"
                autocomplete="off"
                autocapitalize="off"
                spellcheck={false}
                aria-invalid={formError() === null ? undefined : 'true'}
                onInput={(event) => setKey(event.currentTarget.value)}
              />
            </Field>
            <Button type="submit" variant="secondary" block disabled={session.busy()}>
              У меня есть ключ
            </Button>
          </form>

          <p class="console-door-note">
            Ключ хранится только в этой вкладке (sessionStorage) и исчезает, когда вы её закроете. В
            адресную строку, cookie и журналы он не попадает.
          </p>
        </section>
      </main>

      <footer class="console-door-foot">
        <span>Rox Cloud — машины по часам.</span>
        <A href="/status">Состояние сервиса</A>
      </footer>
    </div>
  )
}

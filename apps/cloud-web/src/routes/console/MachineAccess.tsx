import { A } from '@solidjs/router'
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'

import { Button, Card, Icon, Skeleton } from '@/components'
import { api } from '@/lib/api'
import type { NetworkInfo, PortInfo, PreviewLink, SshAccess } from '@/lib/api'
import { formatDate, formatDuration, formatTime } from '@/lib/format'
import { sshConnection } from '@/lib/ssh-access'

import { errorText } from './components/console-ui'
import FirstSiteWizard, { runExampleSite } from './FirstSiteWizard'

import './machine-access.css'

/** Stands in for the link while the eye toggle is off. */
const MASKED_URL = '••••••••••••'

function secondsLeft(expiresAt: number | null | undefined, now: number): number | null {
  if (expiresAt === null || expiresAt === undefined) return null
  return Math.max(0, Math.ceil((expiresAt - now) / 1000))
}

/** `осталось 4 мин 59 с`, or `истекла` once the clock passes the deadline. */
function remainingText(expiresAt: number | null | undefined, now: number): string {
  const left = secondsLeft(expiresAt, now)
  if (left === null) return 'срок не указан'
  return left <= 0 ? 'истекла' : `осталось ${formatDuration(left)}`
}

/** The console icon set has no eye yet; one stroke drawing lives here. */
function EyeIcon(props: { closed: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
      <Show when={props.closed}>
        <path d="M4 20 20 4" />
      </Show>
    </svg>
  )
}

export interface MachineAccessProps {
  sandboxId: string
  enabled: boolean
  reason?: string
}

/**
 * The three ways out of a machine: its private address, a signed link to one
 * HTTP port, and an SSH access. Every secret is created on demand and never
 * stored by the console; both temporary accesses count down to the second.
 * SSH shows a stable alias, while its token stays in the file behind a click.
 */
export default function MachineAccess(props: MachineAccessProps): JSX.Element {
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => window.clearInterval(timer))
  })

  const [network, setNetwork] = createSignal<NetworkInfo | null>(null)
  const [networkError, setNetworkError] = createSignal<string | null>(null)
  const [networkLoading, setNetworkLoading] = createSignal(false)

  const [port, setPort] = createSignal('8000')
  const [ports, setPorts] = createSignal<PortInfo[]>([])
  const [portsError, setPortsError] = createSignal<string | null>(null)
  const [portsLoading, setPortsLoading] = createSignal(false)
  const [portsLoaded, setPortsLoaded] = createSignal(false)
  const [preview, setPreview] = createSignal<PreviewLink | null>(null)
  const [previewError, setPreviewError] = createSignal<string | null>(null)
  const [previewLoading, setPreviewLoading] = createSignal(false)
  const [previewMasked, setPreviewMasked] = createSignal(true)
  const [exampleLoading, setExampleLoading] = createSignal(false)
  const [copied, setCopied] = createSignal(false)

  const [ssh, setSsh] = createSignal<SshAccess | null>(null)
  const [sshError, setSshError] = createSignal<string | null>(null)
  const [sshLoading, setSshLoading] = createSignal(false)
  const [sshCopied, setSshCopied] = createSignal(false)
  const [aliasCopied, setAliasCopied] = createSignal(false)
  const [configOpen, setConfigOpen] = createSignal(false)
  const [configCopied, setConfigCopied] = createSignal(false)
  const [rawOpen, setRawOpen] = createSignal(false)

  const [wizardOpen, setWizardOpen] = createSignal(false)

  let copyTimer: number | undefined
  let sshCopyTimer: number | undefined
  let aliasCopyTimer: number | undefined
  let configCopyTimer: number | undefined
  onCleanup(() => {
    window.clearTimeout(copyTimer)
    window.clearTimeout(sshCopyTimer)
    window.clearTimeout(aliasCopyTimer)
    window.clearTimeout(configCopyTimer)
  })

  const previewLeft = createMemo(() => secondsLeft(preview()?.expiresAt, now()))
  const previewExpired = (): boolean => {
    const left = previewLeft()
    return left !== null && left <= 0
  }
  const sshLeft = createMemo(() => secondsLeft(ssh()?.expiresAt, now()))
  const sshExpired = (): boolean => {
    const left = sshLeft()
    return left !== null && left <= 0
  }
  // The alias is what the customer sees and types; the token lives in the
  // connection object and only reaches the DOM through the opened file.
  const connection = createMemo(() => {
    const access = ssh()
    return access === null ? null : sshConnection(access.command, props.sandboxId)
  })
  const aliasCommand = (): string => `ssh ${connection()?.alias ?? ''}`

  const loadNetwork = async (refresh = false): Promise<void> => {
    if (!props.enabled) return
    setNetworkLoading(true)
    setNetworkError(null)
    try {
      setNetwork(await api.network(props.sandboxId, refresh))
    } catch (failure) {
      setNetwork(null)
      setNetworkError(errorText(failure))
    } finally {
      setNetworkLoading(false)
    }
  }

  const loadPorts = async (): Promise<void> => {
    if (!props.enabled) return
    setPortsLoading(true)
    setPortsError(null)
    try {
      setPorts(await api.ports(props.sandboxId))
      setPortsLoaded(true)
    } catch (failure) {
      setPorts([])
      setPortsError(`Порты не получены: ${errorText(failure)}`)
    } finally {
      setPortsLoading(false)
    }
  }

  const refreshFacts = async (): Promise<void> => {
    if (!props.enabled) return
    await Promise.all([loadNetwork(true), loadPorts()])
  }

  // A memo with primitive equality keeps a parent poll from wiping a link or
  // SSH command: only a new machine or a new running state resets them.
  const resetKey = createMemo(() => `${props.sandboxId}:${props.enabled}`)
  createEffect(
    on(
      resetKey,
      () => {
        setPreview(null)
        setPreviewError(null)
        setPreviewMasked(true)
        setExampleLoading(false)
        setSsh(null)
        setSshError(null)
        setConfigOpen(false)
        setRawOpen(false)
        setSshCopied(false)
        setAliasCopied(false)
        setConfigCopied(false)
        setNetwork(null)
        setNetworkError(null)
        setPorts([])
        setPortsLoaded(false)
        setPortsError(null)
        setWizardOpen(false)
        if (props.enabled) {
          void loadNetwork()
          void loadPorts()
        }
      },
    ),
  )

  const openSite = async (): Promise<void> => {
    if (!props.enabled || previewLoading()) return
    const value = Number(port())
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      setPreviewError('Порт — целое число от 1 до 65535.')
      return
    }
    // Open the tab while the click is still trusted; a popup blocker must not
    // turn a successful request into a silent no-op.
    const tab = window.open('', '_blank')
    setPreviewLoading(true)
    setPreviewError(null)
    setPreview(null)
    try {
      const link = await api.preview(props.sandboxId, value)
      setPreview(link)
      setPreviewMasked(true)
      if (tab !== null) tab.location.href = link.url
    } catch (failure) {
      tab?.close()
      setPreviewError(`Сайт не открылся: ${errorText(failure)}`)
    } finally {
      setPreviewLoading(false)
    }
  }

  const startExample = async (): Promise<void> => {
    if (!props.enabled || exampleLoading()) return
    const value = Number(port())
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      setPreviewError('Порт — целое число от 1 до 65535.')
      return
    }
    const id = props.sandboxId
    const tab = window.open('about:blank', '_blank')
    setExampleLoading(true)
    setPreviewError(null)
    setPreview(null)
    try {
      const outcome = await runExampleSite({ sandboxId: id, port: value, tab })
      if (props.sandboxId !== id) return
      if (outcome.kind === 'error') {
        setPreviewError(outcome.message)
        return
      }
      setPreview(outcome.link)
      setPreviewMasked(true)
      void loadPorts()
    } finally {
      setExampleLoading(false)
    }
  }

  const openLink = (): void => {
    const link = preview()
    if (link === null || previewExpired()) return
    window.open(link.url, '_blank', 'noopener,noreferrer')
  }

  const createSsh = async (): Promise<void> => {
    if (!props.enabled || sshLoading()) return
    setSshLoading(true)
    setSshError(null)
    setSsh(null)
    // A new token starts closed: only the click on «Файл доступа» reveals it.
    setConfigOpen(false)
    setRawOpen(false)
    setSshCopied(false)
    setAliasCopied(false)
    setConfigCopied(false)
    try {
      setSsh(await api.ssh(props.sandboxId))
    } catch (failure) {
      setSshError(`SSH не создан: ${errorText(failure)}`)
    } finally {
      setSshLoading(false)
    }
  }

  const copyLink = async (): Promise<void> => {
    const link = preview()
    if (link === null || previewExpired()) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
      window.clearTimeout(copyTimer)
      copyTimer = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setPreviewError('Браузер не дал скопировать ссылку. Выделите её вручную.')
    }
  }

  const copySsh = async (): Promise<void> => {
    const access = ssh()
    if (access === null || sshExpired()) return
    try {
      await navigator.clipboard.writeText(access.command)
      setSshCopied(true)
      window.clearTimeout(sshCopyTimer)
      sshCopyTimer = window.setTimeout(() => setSshCopied(false), 1600)
    } catch {
      setSshError('Браузер не дал скопировать команду. Выделите её вручную.')
    }
  }

  /** The visible line only: copying it never moves the token to the clipboard. */
  const copyAlias = async (): Promise<void> => {
    if (connection() === null || sshExpired()) return
    try {
      await navigator.clipboard.writeText(aliasCommand())
      setAliasCopied(true)
      window.clearTimeout(aliasCopyTimer)
      aliasCopyTimer = window.setTimeout(() => setAliasCopied(false), 1600)
    } catch {
      setSshError('Браузер не дал скопировать команду. Выделите её вручную.')
    }
  }

  /** The full config, token included: only from the opened file block. */
  const copyConfig = async (): Promise<void> => {
    const value = connection()
    if (value === null || sshExpired()) return
    try {
      await navigator.clipboard.writeText(value.config)
      setConfigCopied(true)
      window.clearTimeout(configCopyTimer)
      configCopyTimer = window.setTimeout(() => setConfigCopied(false), 1600)
    } catch {
      setSshError('Браузер не дал скопировать файл. Выделите его вручную.')
    }
  }

  const choosePort = (value: number): void => {
    setPort(String(value))
    setPreviewError(null)
  }

  return (
    <>
      <Card
        title="Сеть и доступ"
        subtitle="Внутренний адрес машины, подписанная ссылка на сайт и вход по SSH с компьютера."
        footer={
          <A class="access-docs" href="/docs#site-ssh">
            Справка: сайт и SSH
          </A>
        }
      >
        <Show when={!props.enabled}>
          <p class="access-blocked" role="status">
            {props.reason ?? 'Сеть и SSH доступны только на запущенной машине.'}
          </p>
        </Show>
        <div class="access-grid">
          <section class="access-block" aria-label="Внутренний адрес машины">
            <h3 class="access-title">
              <Icon name="globe" size={14} /> Внутренний адрес
            </h3>
            <Show
              when={!networkLoading()}
              fallback={
                <div class="access-loading">
                  <Skeleton lines={2} />
                </div>
              }
            >
              <Show
                when={network() !== null}
                fallback={
                  <p class="access-note">
                    {networkError() === null ? 'Адрес не сообщён.' : `Адрес не получен: ${networkError()}`}
                  </p>
                }
              >
                <p class="access-value">{network()?.privateIp ?? 'не сообщён'}</p>
                <p class="access-note">
                  Адрес внутренний, обычно вида 172.20.x.x: из интернета он не виден, публичного IP у
                  машины нет. Снаружи работают только подписанная ссылка на порт и SSH-шлюз{' '}
                  <code>ssh.rox.computer</code>.
                </p>
              </Show>
            </Show>
          </section>

          <section class="access-block" aria-label="Сайт на машине">
            <h3 class="access-title">
              <Icon name="server" size={14} /> Сайт
            </h3>
            <div class="access-form">
              <label class="access-label" for="access-port">
                Порт
              </label>
              <input
                id="access-port"
                class="input access-port"
                inputmode="numeric"
                value={port()}
                disabled={!props.enabled || previewLoading() || exampleLoading()}
                onInput={(event) => setPort(event.currentTarget.value)}
              />
              <Button
                size="sm"
                variant="secondary"
                loading={previewLoading()}
                disabled={!props.enabled || exampleLoading()}
                onClick={() => void openSite()}
              >
                Открыть сайт
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={exampleLoading()}
                disabled={!props.enabled || previewLoading()}
                onClick={() => void startExample()}
              >
                Запустить пример
              </Button>
            </div>
            <p class="access-note">
              «Запустить пример» поднимает небольшой сервер на этом порту в папке <code>~/site</code>{' '}
              и кладёт туда страницу Rox, только если <code>index.html</code> ещё нет. Или запустите
              свой сервер в терминале, например
              {' '}
              <code>python3 -m http.server {port()} --directory ~/site</code>.
            </p>
            <p class="access-note">
              Ссылка открывает этот порт по адресу <code>preview.rox.computer/&lt;подпись&gt;/</code>. Ответ 502 значит, что
              сайт внутри машины не отвечает: проверьте, что сервер на порту запущен.
            </p>

            <Show when={props.enabled}>
              <div class="access-ports">
                <div class="access-ports-head">
                  <span class="access-label">Порты на машине</span>
                  <button
                    type="button"
                    class="access-copy"
                    disabled={portsLoading()}
                    onClick={() => void refreshFacts()}
                  >
                    {portsLoading() ? 'Обновляю…' : 'Обновить'}
                  </button>
                </div>
                <Show
                  when={portsError() === null}
                  fallback={<p class="access-note access-error">{portsError()}</p>}
                >
                  <Show when={ports().length > 0} fallback={
                    <p class="access-note">
                      {portsLoading() || !portsLoaded()
                        ? 'Смотрю порты…'
                        : 'Портов не видно: сервер внутри машины ещё не запущен.'}
                    </p>
                  }>
                    <div class="access-chips">
                      <For each={ports()}>
                        {(item) => (
                          <button
                            type="button"
                            class="access-chip"
                            classList={{
                              'is-reserved': item.reserved,
                              'is-active': !item.reserved && Number(port()) === item.port,
                            }}
                            disabled={item.reserved}
                            title={
                              item.reserved
                                ? 'Служебный порт машины: ссылкой не открывается'
                                : `Подставить порт ${item.port}`
                            }
                            onClick={() => choosePort(item.port)}
                          >
                            <span class="access-chip-port">{item.port}</span>
                            <Show when={item.reserved}>
                              <span class="access-chip-tag">служба машины</span>
                            </Show>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </Show>
              </div>
            </Show>

            <div class="access-wizard">
              <Button
                size="sm"
                variant="secondary"
                disabled={!props.enabled}
                title={props.enabled ? undefined : props.reason}
                onClick={() => setWizardOpen(true)}
              >
                Мастер первого сайта
              </Button>
              <span class="access-note">Проверит порт, откроет ссылку и покажет вход по SSH.</span>
            </div>

            <Show when={previewError() !== null}>
              <p class="access-error" role="alert">
                {previewError()}
              </p>
            </Show>
            <Show when={preview() !== null}>
              <div class="access-link" classList={{ 'is-expired': previewExpired() }}>
                <span
                  class="access-link-value"
                  classList={{ 'is-masked': previewMasked() }}
                  title={previewMasked() ? undefined : preview()?.url}
                >
                  {previewMasked() ? MASKED_URL : preview()?.url}
                </span>
                <button
                  type="button"
                  class="access-copy access-eye"
                  aria-pressed={previewMasked() ? 'false' : 'true'}
                  aria-label={previewMasked() ? 'Показать ссылку' : 'Скрыть ссылку'}
                  title={previewMasked() ? 'Показать ссылку' : 'Скрыть ссылку'}
                  onClick={() => setPreviewMasked((value) => !value)}
                >
                  <EyeIcon closed={previewMasked()} />
                </button>
                <button
                  type="button"
                  class="access-copy"
                  disabled={previewExpired()}
                  onClick={() => void copyLink()}
                >
                  {copied() ? 'Скопировано' : 'Копировать'}
                </button>
                <button
                  type="button"
                  class="access-copy"
                  disabled={previewExpired()}
                  onClick={openLink}
                >
                  Открыть
                </button>
              </div>
              <p class="access-note" classList={{ 'is-expired': previewExpired() }}>
                до {formatTime(preview()?.expiresAt ?? null)} ·{' '}
                {remainingText(preview()?.expiresAt ?? null, now())} · только порт {preview()?.port}
              </p>
              <p class="access-note">
                Ссылка = доступ: пока она действует, её владелец открывает этот порт. Не пересылайте её в чужие чаты.
              </p>
            </Show>
          </section>

          <section class="access-block" aria-label="Вход по SSH">
            <h3 class="access-title">
              <Icon name="terminal" size={14} /> SSH
            </h3>
            <Button
              size="sm"
              variant="secondary"
              loading={sshLoading()}
              disabled={!props.enabled}
              onClick={() => void createSsh()}
            >
              Создать доступ
            </Button>
            <p class="access-note">
              «Создать доступ» выдаёт временный ключ: он работает до указанного срока, а не один
              раз. В терминале вы набираете короткое имя вида <code>rox-…</code>, а сам ключ лежит в
              отдельном файле доступа. Имя только называет ключ и не заменяет его защиту: пока ключ
              действует, его владелец входит на машину. Вы войдёте как <code>rox</code>, увидите
              приглашение <code>rox@rox-computer</code>, а домашний каталог будет <code>~</code>.
            </p>
            <Show when={sshError() !== null}>
              <p class="access-error" role="alert">
                {sshError()}
              </p>
            </Show>
            <Show when={ssh() !== null}>
              <Show
                when={connection() !== null}
                fallback={
                  <p class="access-note">
                    Команда пришла в незнакомом виде: откройте её целиком и вставьте в терминал
                    вручную.
                  </p>
                }
              >
                <div class="access-ssh" classList={{ 'is-expired': sshExpired() }}>
                  <code>{aliasCommand()}</code>
                  <button
                    type="button"
                    class="access-copy"
                    disabled={sshExpired()}
                    onClick={() => void copyAlias()}
                  >
                    {aliasCopied() ? 'Скопировано' : 'Копировать'}
                  </button>
                </div>
              </Show>
              <div class="access-disclosure-row">
                <Show when={connection() !== null}>
                  <button
                    type="button"
                    class="access-disclosure"
                    aria-expanded={configOpen() ? 'true' : 'false'}
                    onClick={() => setConfigOpen((value) => !value)}
                  >
                    Файл доступа
                  </button>
                </Show>
                <button
                  type="button"
                  class="access-disclosure"
                  aria-expanded={rawOpen() ? 'true' : 'false'}
                  onClick={() => setRawOpen((value) => !value)}
                >
                  Показать исходную команду
                </button>
              </div>
              <Show when={configOpen() && connection() !== null}>
                <pre class="access-config" classList={{ 'is-expired': sshExpired() }}>
                  <code>{connection()?.config}</code>
                </pre>
                <div class="access-config-actions">
                  <button
                    type="button"
                    class="access-copy"
                    disabled={sshExpired()}
                    onClick={() => void copyConfig()}
                  >
                    {configCopied() ? 'Скопировано' : 'Скопировать файл'}
                  </button>
                  <span class="access-note">
                    Сохраните как <code>~/.ssh/rox/{connection()?.alias}.conf</code>, закройте права{' '}
                    <code>chmod 600</code> и один раз добавьте в <code>~/.ssh/config</code> строку{' '}
                    <code>Include ~/.ssh/rox/*.conf</code>.
                  </span>
                </div>
              </Show>
              <Show when={rawOpen()}>
                <div class="access-raw" classList={{ 'is-expired': sshExpired() }}>
                  <code>{ssh()?.command}</code>
                  <button
                    type="button"
                    class="access-copy"
                    disabled={sshExpired()}
                    onClick={() => void copySsh()}
                  >
                    {sshCopied() ? 'Скопировано' : 'Копировать'}
                  </button>
                </div>
                <p class="access-note">
                  Здесь токен записан целиком — это тот же временный ключ. Для обычной работы
                  пользуйтесь файлом доступа.
                </p>
              </Show>
              <p class="access-note" classList={{ 'is-expired': sshExpired() }}>
                Действует до {formatDate(ssh()?.expiresAt ?? null)} ·{' '}
                {remainingText(ssh()?.expiresAt ?? null, now())}.
              </p>
              <Show when={sshExpired()}>
                <p class="access-note">Доступ больше не работает. Создайте его заново.</p>
              </Show>
            </Show>
          </section>
        </div>
      </Card>

      <FirstSiteWizard
        open={wizardOpen()}
        onClose={() => setWizardOpen(false)}
        sandboxId={props.sandboxId}
        enabled={props.enabled}
      />
    </>
  )
}

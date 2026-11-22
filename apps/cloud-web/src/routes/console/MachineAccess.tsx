import { Show, createEffect, createMemo, createSignal, on } from 'solid-js'
import type { JSX } from 'solid-js'

import { Button, Card, Icon, Skeleton } from '@/components'
import { api } from '@/lib/api'
import type { NetworkInfo, PreviewLink, SshAccess } from '@/lib/api'
import { formatDate, formatTime } from '@/lib/format'

import { errorText } from './components/console-ui'

import './machine-access.css'

export interface MachineAccessProps {
  sandboxId: string
  enabled: boolean
  reason?: string
}

/**
 * The three ways out of a machine: its private address, a signed link to one
 * HTTP port, and a one-shot SSH command. Every secret is created on demand and
 * never stored by the console.
 */
export default function MachineAccess(props: MachineAccessProps): JSX.Element {
  const [network, setNetwork] = createSignal<NetworkInfo | null>(null)
  const [networkError, setNetworkError] = createSignal<string | null>(null)
  const [networkLoading, setNetworkLoading] = createSignal(false)

  const [port, setPort] = createSignal('8000')
  const [preview, setPreview] = createSignal<PreviewLink | null>(null)
  const [previewError, setPreviewError] = createSignal<string | null>(null)
  const [previewLoading, setPreviewLoading] = createSignal(false)
  const [copied, setCopied] = createSignal(false)

  const [ssh, setSsh] = createSignal<SshAccess | null>(null)
  const [sshError, setSshError] = createSignal<string | null>(null)
  const [sshLoading, setSshLoading] = createSignal(false)
  const [sshCopied, setSshCopied] = createSignal(false)

  let copyTimer: number | undefined
  let sshCopyTimer: number | undefined

  const loadNetwork = async (): Promise<void> => {
    setNetworkLoading(true)
    setNetworkError(null)
    try {
      setNetwork(await api.network(props.sandboxId))
    } catch (failure) {
      setNetwork(null)
      setNetworkError(errorText(failure))
    } finally {
      setNetworkLoading(false)
    }
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
        setSsh(null)
        setSshError(null)
        setNetwork(null)
        setNetworkError(null)
        if (props.enabled) void loadNetwork()
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
      if (tab !== null) tab.location.href = link.url
    } catch (failure) {
      tab?.close()
      setPreviewError(`Сайт не открылся: ${errorText(failure)}`)
    } finally {
      setPreviewLoading(false)
    }
  }

  const createSsh = async (): Promise<void> => {
    if (!props.enabled || sshLoading()) return
    setSshLoading(true)
    setSshError(null)
    setSsh(null)
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
    if (link === null) return
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
    if (access === null) return
    try {
      await navigator.clipboard.writeText(access.command)
      setSshCopied(true)
      window.clearTimeout(sshCopyTimer)
      sshCopyTimer = window.setTimeout(() => setSshCopied(false), 1600)
    } catch {
      setSshError('Браузер не дал скопировать команду. Выделите её вручную.')
    }
  }

  return (
    <Card
      title="Сеть и доступ"
      subtitle="Приватный адрес машины, ссылка на сайт и вход по SSH с компьютера."
    >
      <Show when={!props.enabled}>
        <p class="access-blocked" role="status">
          {props.reason ?? 'Сеть и SSH доступны только на запущенной машине.'}
        </p>
      </Show>
      <div class="access-grid">
        <section class="access-block" aria-label="Адрес машины">
          <h3 class="access-title">
            <Icon name="globe" size={14} /> Адрес
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
                {network()?.publicIp === null || network()?.publicIp === undefined
                  ? 'Своего публичного IP нет: снаружи машина открыта ссылкой на порт и SSH-шлюзом.'
                  : `Публичный адрес: ${network()?.publicIp}`}
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
              disabled={!props.enabled || previewLoading()}
              onInput={(event) => setPort(event.currentTarget.value)}
            />
            <Button
              size="sm"
              variant="secondary"
              loading={previewLoading()}
              disabled={!props.enabled}
              onClick={() => void openSite()}
            >
              Открыть сайт
            </Button>
          </div>
          <p class="access-note">
            Запустите в терминале сервер на этом порту, например
            {' '}
            <code>python3 -m http.server {port()}</code>.
          </p>
          <Show when={previewError() !== null}>
            <p class="access-error" role="alert">
              {previewError()}
            </p>
          </Show>
          <Show when={preview() !== null}>
            <div class="access-link">
              <a href={preview()?.url} target="_blank" rel="noreferrer">
                {preview()?.url}
              </a>
              <button type="button" class="access-copy" onClick={() => void copyLink()}>
                {copied() ? 'Скопировано' : 'Копировать'}
              </button>
            </div>
            <p class="access-note">
              до {formatTime(preview()?.expiresAt ?? null)} · только порт {preview()?.port}
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
            Команда для вашего терминала. Внутри машины пользователь остаётся <code>daytona</code>,
            а ключ живёт до указанного времени.
          </p>
          <Show when={sshError() !== null}>
            <p class="access-error" role="alert">
              {sshError()}
            </p>
          </Show>
          <Show when={ssh() !== null}>
            <div class="access-ssh">
              <code title={ssh()?.command}>{ssh()?.command}</code>
              <button type="button" class="access-copy" onClick={() => void copySsh()}>
                {sshCopied() ? 'Скопировано' : 'Копировать'}
              </button>
            </div>
            <p class="access-note">Действует до {formatDate(ssh()?.expiresAt ?? null)}.</p>
          </Show>
        </section>
      </div>
    </Card>
  )
}

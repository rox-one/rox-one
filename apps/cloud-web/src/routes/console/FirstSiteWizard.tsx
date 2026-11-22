import { Show, createEffect, createSignal, on } from 'solid-js'
import type { JSX } from 'solid-js'

import { Button, CodeBlock, Dialog, Field } from '@/components'
import { api } from '@/lib/api'
import type { PortInfo, PreviewLink } from '@/lib/api'
import { formatTime } from '@/lib/format'

import { errorText } from './components/console-ui'

import './machine-panels.css'

const SERVER_COMMAND = 'python3 -m http.server 8000'

const URL_SECRET = /\b(?:https?|wss?):\/\/[^\s<>"']+/gi
const NAMED_SECRET = /\b(token|secret|password|passwd|api[_-]?key|key)=[^\s,&;]+/gi

/** The server's own words, with any address or named secret cut out. */
function safeError(err: unknown): string {
  return errorText(err).replace(URL_SECRET, '[адрес скрыт]').replace(NAMED_SECRET, '$1=скрыт')
}

function portNumber(raw: string): number | null {
  const value = Number(raw.trim())
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : null
}

export interface FirstSiteWizardProps {
  open: boolean
  onClose: () => void
  sandboxId: string
  enabled: boolean
}

/**
 * Three steps to the first site on a machine: the command a person runs in
 * the terminal, a check of the ports the machine actually listens on, and a
 * signed link to the chosen one. The wizard never runs the command itself.
 */
export default function FirstSiteWizard(props: FirstSiteWizardProps): JSX.Element {
  const [port, setPort] = createSignal('8000')
  const [ports, setPorts] = createSignal<PortInfo[]>([])
  const [checkedPort, setCheckedPort] = createSignal<number | null>(null)
  const [checking, setChecking] = createSignal(false)
  const [portsError, setPortsError] = createSignal<string | null>(null)
  const [preview, setPreview] = createSignal<PreviewLink | null>(null)
  const [previewLoading, setPreviewLoading] = createSignal(false)
  const [previewError, setPreviewError] = createSignal<string | null>(null)

  const portStatus = (): 'open' | 'closed' | 'unknown' => {
    const checked = checkedPort()
    if (checked === null) return 'unknown'
    if (portNumber(port()) !== checked) return 'unknown'
    return ports().some((item) => item.port === checked) ? 'open' : 'closed'
  }

  const listeningText = (): string => {
    const visible = ports().filter((item) => !item.reserved)
    if (visible.length > 0) return `Слушают: ${visible.map((item) => item.port).join(', ')}.`
    if (ports().length > 0) return 'Слушают только служебные порты Rox.'
    return 'Пока не слушает ни один порт.'
  }

  const checkPorts = async (): Promise<void> => {
    if (!props.enabled || checking()) return
    const value = portNumber(port())
    if (value === null) {
      setPortsError('Порт — целое число от 1 до 65535.')
      return
    }
    setChecking(true)
    setPortsError(null)
    try {
      const list = await api.ports(props.sandboxId)
      setPorts(list)
      setCheckedPort(value)
    } catch (err) {
      setCheckedPort(null)
      setPortsError(`Порты не проверены: ${safeError(err)}`)
    } finally {
      setChecking(false)
    }
  }

  const makeLink = async (): Promise<void> => {
    if (!props.enabled || previewLoading()) return
    const value = portNumber(port())
    if (value === null) {
      setPreviewError('Порт — целое число от 1 до 65535.')
      return
    }
    setPreviewLoading(true)
    setPreviewError(null)
    setPreview(null)
    try {
      setPreview(await api.preview(props.sandboxId, value))
    } catch (err) {
      setPreviewError(`Ссылка не создана: ${safeError(err)}`)
    } finally {
      setPreviewLoading(false)
    }
  }

  createEffect(
    on(
      () =>
        `${props.open ? '1' : '0'}\u0000${props.sandboxId}\u0000${props.enabled ? '1' : '0'}`,
      () => {
        setPort('8000')
        setPorts([])
        setCheckedPort(null)
        setChecking(false)
        setPortsError(null)
        setPreview(null)
        setPreviewLoading(false)
        setPreviewError(null)
        if (props.open && props.enabled && props.sandboxId.length > 0) void checkPorts()
      },
    ),
  )

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      wide
      title="Первый сайт на машине"
      subtitle="Три шага: сервер в терминале, проверка порта и ссылка из кабинета."
      footer={
        <Button variant="ghost" onClick={props.onClose}>
          Закрыть
        </Button>
      }
    >
      <Show when={!props.enabled}>
        <p class="mp-note">
          Машина не запущена, поэтому ссылку создать нельзя. Запустите её и откройте этот мастер
          снова.
        </p>
      </Show>

      <div class="mp-steps">
        <section class="mp-step" aria-labelledby="mp-step-1">
          <span class="mp-step-num" aria-hidden="true">
            1
          </span>
          <div class="mp-step-body">
            <h3 class="mp-step-title" id="mp-step-1">
              Запустите сервер
            </h3>
            <p class="mp-step-text">
              Скопируйте команду и выполните её в терминале машины. Кабинет не запускает команды
              сам — только показывает ссылку на уже работающий сервер.
            </p>
            <CodeBlock code={SERVER_COMMAND} label="Команда в терминале" />
          </div>
        </section>

        <section class="mp-step" aria-labelledby="mp-step-2">
          <span class="mp-step-num" aria-hidden="true">
            2
          </span>
          <div class="mp-step-body">
            <h3 class="mp-step-title" id="mp-step-2">
              Проверьте порт
            </h3>
            <p class="mp-step-text">
              Введите порт из команды. Проверка читает порты, которые машина уже слушает, и
              ничего не запускает.
            </p>
            <div class="mp-inline">
              <Field label="Порт" for="mp-wizard-port">
                <input
                  id="mp-wizard-port"
                  class="input mp-port-input"
                  inputmode="numeric"
                  autocomplete="off"
                  value={port()}
                  disabled={!props.enabled || checking()}
                  onInput={(event) => setPort(event.currentTarget.value)}
                />
              </Field>
              <Button
                variant="secondary"
                size="sm"
                loading={checking()}
                disabled={!props.enabled}
                onClick={() => void checkPorts()}
              >
                {checkedPort() === null ? 'Проверить порт' : 'Проверить снова'}
              </Button>
            </div>
            <p class="mp-note">Тот же порт, что в команде: обычно 8000.</p>

            <Show when={portsError() !== null}>
              <p class="mp-error-quiet" role="alert">
                {portsError()}
              </p>
            </Show>

            <Show when={portsError() === null && checkedPort() !== null}>
              <Show
                when={portStatus() === 'open'}
                fallback={
                  <Show
                    when={portStatus() === 'closed'}
                    fallback={<p class="mp-note">Порт изменён — проверьте его снова.</p>}
                  >
                    <p class="mp-warn-text" role="status">
                      Порт {port()} не слушает. Запустите сервер в терминале и нажмите
                      «Проверить снова».
                    </p>
                  </Show>
                }
              >
                <p class="mp-ok-text" role="status">
                  Порт {port()} слушает.
                </p>
                <Show
                  when={ports().some(
                    (item) => item.port === portNumber(port()) && item.reserved,
                  )}
                >
                  <p class="mp-warn-text">
                    Это служебный порт Rox: сайт на нём не открыть. Выберите порт своего сервера.
                  </p>
                </Show>
              </Show>
              <p class="mp-note">{listeningText()}</p>
            </Show>
          </div>
        </section>

        <section class="mp-step" aria-labelledby="mp-step-3">
          <span class="mp-step-num" aria-hidden="true">
            3
          </span>
          <div class="mp-step-body">
            <h3 class="mp-step-title" id="mp-step-3">
              Откройте сайт
            </h3>
            <p class="mp-step-text">
              Кабинет подпишет ссылку на этот порт на короткое время. Пока сервер слушает, ссылка
              откроет сайт в новой вкладке.
            </p>
            <div class="mp-inline">
              <Button
                variant="primary"
                size="sm"
                loading={previewLoading()}
                disabled={!props.enabled}
                onClick={() => void makeLink()}
              >
                Получить ссылку
              </Button>
              <Show when={preview() !== null}>
                <a
                  class="btn btn-secondary btn-sm"
                  href={preview()?.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть сайт
                </a>
              </Show>
            </div>

            <Show when={preview() !== null}>
              <p class="mp-link-line">
                <a
                  class="mp-link"
                  href={preview()?.url}
                  target="_blank"
                  rel="noreferrer"
                  title="Подписанная ссылка на порт"
                >
                  {preview()?.url}
                </a>
              </p>
              <p class="mp-note">
                Порт {preview()?.port} · действует до {formatTime(preview()?.expiresAt ?? null)}
              </p>
            </Show>

            <Show when={previewError() !== null}>
              <p class="mp-error-quiet" role="alert">
                {previewError()}
              </p>
              <p class="mp-note">
                Если порт закрыт, сервер ещё не запущен. Выполните команду из первого шага и
                проверьте порт снова — ссылка появится после этого.
              </p>
              <div class="mp-inline">
                <Button
                  variant="ghost"
                  size="sm"
                  loading={checking()}
                  disabled={!props.enabled}
                  onClick={() => void checkPorts()}
                >
                  Проверить снова
                </Button>
              </div>
            </Show>
          </div>
        </section>
      </div>
    </Dialog>
  )
}

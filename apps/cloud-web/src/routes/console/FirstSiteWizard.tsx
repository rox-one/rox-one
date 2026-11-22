import { Show, createEffect, createSignal, on } from 'solid-js'
import type { JSX } from 'solid-js'

import { Button, CodeBlock, Dialog, Field } from '@/components'
import { ApiError, api } from '@/lib/api'
import type { PortInfo, PreviewLink } from '@/lib/api'
import { formatTime } from '@/lib/format'

import { errorText } from './components/console-ui'

import './machine-panels.css'

/** Where the example server writes its own words; only a diagnosis reads it. */
const EXAMPLE_LOG = '/tmp/rox-site.log'
/** The home a customer sees in the terminal: the working directory of console commands, never the site root. */
const EXAMPLE_HOME = '/home/rox'
/** The example site root: a folder of its own, never the whole home directory. */
const EXAMPLE_SITE = '/home/rox/site'

/**
 * The starter page the example server shows. One self-contained file: no
 * fonts, scripts, images or network requests, so it opens on a machine cut off
 * from the internet, and a fluid layout keeps it readable on a phone and on a
 * desktop. It says whose site this is and how to replace the file.
 */
const EXAMPLE_PAGE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ваш сайт на Rox</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    padding: clamp(1.25rem, 6vw, 3.5rem) clamp(1rem, 5vw, 2.5rem);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 1rem;
    line-height: 1.55;
    color: #161a1f;
    background: #f5f6f8;
    -webkit-text-size-adjust: 100%;
  }
  main { max-width: 38rem; margin: 0 auto; }
  .brand {
    margin: 0 0 0.75rem;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #2f5bea;
  }
  .rule { width: 3rem; height: 2px; margin: 0 0 1.5rem; border: 0; background: #2f5bea; }
  h1 { margin: 0 0 1rem; font-size: clamp(1.75rem, 7vw, 2.5rem); line-height: 1.12; }
  p { margin: 0 0 1rem; }
  .lede { font-size: clamp(1rem, 2.5vw, 1.125rem); color: #3c4552; }
  .list { margin: 0 0 1.5rem; padding-left: 1.2rem; }
  .list li { margin: 0 0 0.6rem; }
  code {
    padding: 0.1rem 0.35rem;
    border-radius: 0.35rem;
    background: #e6e9ee;
    font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.9em;
    overflow-wrap: anywhere;
  }
  .foot { margin: 2rem 0 0; font-size: 0.875rem; color: #5e6876; }
</style>
</head>
<body>
<main>
<p class="brand">Rox</p>
<hr class="rule">
<h1>Это ваш сайт на Rox</h1>
<p class="lede">Перед вами файл <code>index.html</code> из папки <code>~/site</code> на вашей машине. Сервер отдаёт его по вашему адресу, пока вы не положите рядом свой сайт.</p>
<ul class="list">
<li>Откройте папку <code>~/site</code> в терминале или в файловом браузере.</li>
<li>Замените <code>index.html</code> своим файлом: страницей, шаблоном или готовой сборкой.</li>
<li>Добавьте рядом стили, картинки и другие файлы, которые нужны сайту.</li>
<li>Обновите страницу в браузере: новый файл откроется сразу, перезапускать сервер не нужно.</li>
</ul>
<p class="foot">Страницу собрал Rox. В ней нет внешних шрифтов, скриптов и картинок, поэтому она работает без интернета.</p>
</main>
</body>
</html>
`

const LISTENER_FIRST_WAIT_MS = 500
const LISTENER_WAIT_MS = 600
const LISTENER_WAIT_TRIES = 8

const URL_SECRET = /\b(?:https?|wss?):\/\/[^\s<>"']+/gi
const NAMED_SECRET = /\b(token|secret|password|passwd|api[_-]?key|key)=[^\s,&;]+/gi
/** The upstream machine provider never reaches the customer's screen. */
const UPSTREAM_WORD =
  /\b(?:daytona|modal|cloudflare|fly|render|railway|northflank|digitalocean|hetzner|vultr|linode|aws|gcp|azure|e2b)\b/gi
const HOME_PATH = /\/(?:home|Users)\/[A-Za-z0-9._-]+/g

/** The server's own words, with any address, home path or named secret cut out. */
export function safeMachineError(err: unknown): string {
  return errorText(err)
    .replace(URL_SECRET, '[адрес скрыт]')
    .replace(NAMED_SECRET, '$1=скрыт')
    .replace(UPSTREAM_WORD, '[площадка]')
    .replace(HOME_PATH, '[домашний каталог]')
}

function portNumber(raw: string): number | null {
  const value = Number(raw.trim())
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : null
}

/** UTF-8 bytes as base64: `btoa` alone cannot carry Cyrillic. */
function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * Creates `~/site` and writes the starter page only when it is absent, so a
 * second click never overwrites a page the person has already replaced. The
 * HTML travels as base64, so no quote from the page ever reaches the shell.
 */
function prepareSiteCommand(): string {
  return (
    `mkdir -p ${EXAMPLE_SITE}; ` +
    `if [ ! -f ${EXAMPLE_SITE}/index.html ]; then ` +
    `printf '%s' '${base64Utf8(EXAMPLE_PAGE)}' | base64 -d > ${EXAMPLE_SITE}/index.html; fi`
  )
}

/**
 * Stops only the example server this console used to start: its command is
 * `python3 -m http.server <port>`, its work directory is the home and its
 * diagnostics went to the example log. A server the person started from any
 * other folder, or one already serving `~/site`, is left running. Missing
 * /proc or pgrep simply means there is nothing to migrate.
 */
function stopLegacyExampleCommand(port: number): string {
  return [
    `for pid in $(pgrep -f "python3 -m http.server ${port}" 2>/dev/null); do`,
    '  [ -e "/proc/$pid/cwd" ] || continue',
    "  cmd=$(tr '\\000' ' ' <\"/proc/$pid/cmdline\" 2>/dev/null) || continue",
    '  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null) || continue',
    '  err=$(readlink "/proc/$pid/fd/2" 2>/dev/null) || continue',
    '  case "$cmd" in *--directory*) continue ;; esac',
    `  if [ "$cwd" = "${EXAMPLE_HOME}" ] && [ "$err" = "${EXAMPLE_LOG}" ]; then`,
    '    kill "$pid" 2>/dev/null || true',
    '    echo ROX_RETIRED',
    '  fi',
    'done',
    'exit 0',
  ].join('\n')
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })

/** Polls listening ports: the exit code of `nohup … &` proves nothing on its own. */
async function waitForListener(sandboxId: string, port: number): Promise<boolean> {
  for (let attempt = 0; attempt < LISTENER_WAIT_TRIES; attempt += 1) {
    await delay(attempt === 0 ? LISTENER_FIRST_WAIT_MS : LISTENER_WAIT_MS)
    try {
      const list = await api.ports(sandboxId)
      if (list.some((item) => item.port === port && !item.reserved)) return true
    } catch {
      // One unreadable list is not proof the server is down; keep waiting.
    }
  }
  return false
}

type StartVerdict = 'no-python3' | 'port-busy' | 'unknown'

/**
 * Asks the machine why the example server did not appear. The guest prints one
 * fixed marker and never a path, so no machine detail reaches the page.
 */
async function diagnoseStart(sandboxId: string): Promise<StartVerdict> {
  try {
    const probe = await api.exec(sandboxId, {
      command:
        'if ! command -v python3 >/dev/null 2>&1; then echo ROX_NO_PYTHON3; ' +
        `elif grep -q "Address already in use" ${EXAMPLE_LOG} 2>/dev/null; then echo ROX_PORT_BUSY; ` +
        'else echo ROX_UNKNOWN; fi',
      cwd: EXAMPLE_HOME,
      timeoutSec: 10,
    })
    const marker = probe.stdout.trim().split('\n').pop() ?? ''
    if (marker === 'ROX_NO_PYTHON3') return 'no-python3'
    if (marker === 'ROX_PORT_BUSY') return 'port-busy'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/** On this route 409 means nothing listens on the port, not that a provider failed. */
function previewFailureText(err: unknown, port: number): string {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      return `На порту ${port} сейчас никто не слушает: ссылка выдаётся только на работающий сервер.`
    }
    if (err.status === 502) {
      return `Сервер на порту ${port} не ответил. Проверьте, что он запущен, и повторите.`
    }
    if (err.status === 404) {
      return 'Машина не найдена: возможно, она уже остановлена. Обновите страницу.'
    }
  }
  return `Ссылка не создана: ${safeMachineError(err)}`
}

export interface ExampleSiteRun {
  sandboxId: string
  port: number
  /** The tab the caller opened during the click; it is navigated or closed here. */
  tab: Window | null
}

export type ExampleSiteOutcome =
  | { kind: 'link'; link: PreviewLink; opened: boolean }
  | { kind: 'error'; message: string }

/**
 * Starts the example web server inside the machine and points `tab` at the
 * signed link to it. The caller opens the tab while the click is still trusted:
 * a popup blocker must not turn a working machine into a silent no-op. Every
 * step is keyed by `sandboxId`, and the caller drops the outcome if the machine
 * changed meanwhile. A tab is never left behind on failure.
 */
export async function runExampleSite(input: ExampleSiteRun): Promise<ExampleSiteOutcome> {
  const { sandboxId, port, tab } = input
  const fail = (message: string): ExampleSiteOutcome => {
    try {
      tab?.close()
    } catch {
      // The browser may have closed the tab already.
    }
    return { kind: 'error', message }
  }

  // First look at the port list only to refuse a port that belongs to the
  // machine itself. Whether something serves is asked again after migration.
  try {
    const found = (await api.ports(sandboxId)).find((item) => item.port === port)
    if (found?.reserved === true) {
      return fail(`Порт ${port} занят службой самой машины: сайт на нём не открыть. Выберите другой порт.`)
    }
  } catch {
    // The port list is a hint, not a gate: starting the server still makes sense.
  }

  // Prepare the example folder before any server touches the port. The page is
  // written only when absent: a replaced index.html survives a second click.
  try {
    const prepared = await api.exec(sandboxId, {
      command: prepareSiteCommand(),
      cwd: EXAMPLE_HOME,
      timeoutSec: 15,
    })
    if (prepared.exitCode !== null && prepared.exitCode !== 0) {
      return fail(
        `Папка примера не подготовлена: ${safeMachineError(prepared.stderr.trim().slice(0, 200)) || 'команда вернула ошибку'}.`,
      )
    }
  } catch (err) {
    return fail(`Папка примера не подготовлена: ${safeMachineError(err)}.`)
  }

  // An older build served the whole home from this port. Retire exactly that
  // server before the listener check; anything else on the port stays alive.
  try {
    const retired = await api.exec(sandboxId, {
      command: stopLegacyExampleCommand(port),
      cwd: EXAMPLE_HOME,
      timeoutSec: 10,
    })
    if (retired.stdout.includes('ROX_RETIRED')) await delay(250)
  } catch {
    // No /proc and no pgrep: there is no legacy server, the new root still starts.
  }

  let listening = false
  try {
    listening = (await api.ports(sandboxId)).some((item) => item.port === port)
  } catch {
    // An unreadable list is not proof the port is free: try to start anyway.
  }

  if (!listening) {
    try {
      const started = await api.exec(sandboxId, {
        command: `nohup python3 -m http.server ${port} --directory ${EXAMPLE_SITE} >${EXAMPLE_LOG} 2>&1 &`,
        cwd: EXAMPLE_HOME,
        timeoutSec: 15,
      })
      if (started.exitCode !== null && started.exitCode !== 0) {
        return fail(
          `Пример не запустился: ${safeMachineError(started.stderr.trim().slice(0, 200)) || 'команда вернула ошибку'}.`,
        )
      }
    } catch (err) {
      return fail(`Пример не запустился: ${safeMachineError(err)}.`)
    }
    // `nohup … &` returns 0 before the server is ready: the listener is the proof.
    if (!(await waitForListener(sandboxId, port))) {
      const verdict = await diagnoseStart(sandboxId)
      if (verdict === 'no-python3') {
        return fail(
          'На машине нет python3, поэтому пример не запустился. Запустите свой сервер в терминале и нажмите «Открыть сайт».',
        )
      }
      if (verdict === 'port-busy') {
        return fail(`Порт ${port} уже занят другим процессом. Остановите старый сервер или выберите другой порт.`)
      }
      return fail(`Порт ${port} не начал слушать. Запустите сервер в терминале или выберите другой порт.`)
    }
  }

  let link: PreviewLink
  try {
    link = await api.preview(sandboxId, port)
  } catch (err) {
    return fail(previewFailureText(err, port))
  }
  if (link.url.length === 0) return fail('Ссылка не создана: сервер вернул пустой адрес.')

  let opened = false
  if (tab !== null) {
    try {
      tab.location.href = link.url
      opened = !tab.closed
    } catch {
      // A tab the browser already closed: the caller shows the link instead.
    }
  }
  if (!opened) {
    try {
      tab?.close()
    } catch {
      // Nothing left to close.
    }
  }
  return { kind: 'link', link, opened }
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
  const [exampleLoading, setExampleLoading] = createSignal(false)

  const exampleCommand = (): string =>
    `python3 -m http.server ${port() || '8000'} --directory ~/site`

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
      setPortsError(`Порты не проверены: ${safeMachineError(err)}`)
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
      setPreviewError(`Ссылка не создана: ${safeMachineError(err)}`)
    } finally {
      setPreviewLoading(false)
    }
  }

  const startExample = async (): Promise<void> => {
    if (!props.enabled || exampleLoading()) return
    const value = portNumber(port())
    if (value === null) {
      setPreviewError('Порт — целое число от 1 до 65535.')
      return
    }
    const id = props.sandboxId
    // Open the tab during the click, before any await can trip a popup blocker.
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
      setCheckedPort(value)
      try {
        setPorts(await api.ports(id))
      } catch {
        // The link is already created; the port list is only a hint.
      }
    } finally {
      setExampleLoading(false)
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
        setExampleLoading(false)
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
              Запустите пример одной кнопкой или скопируйте команду и выполните её в терминале
              машины. Пример живёт в папке <code>~/site</code>: кнопка создаёт её и кладёт
              <code>index.html</code>, только если файла ещё нет, поэтому ваш файл не пропадёт.
              Кабинет подпишет ссылку только на уже работающий сервер.
            </p>
            <CodeBlock code={exampleCommand()} label="Команда в терминале" />
            <div class="mp-inline">
              <Button
                variant="secondary"
                size="sm"
                loading={exampleLoading()}
                disabled={!props.enabled || previewLoading()}
                onClick={() => void startExample()}
              >
                Запустить пример
              </Button>
              <span class="mp-note">
                Поднимает небольшой сервер на порту {port() || '8000'} в папке <code>~/site</code>.
              </span>
            </div>
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
                Если порт закрыт, сервер ещё не запущен. Нажмите «Запустить пример» или выполните
                команду из первого шага, затем проверьте порт снова — ссылка появится после этого.
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

import { For, Show, createEffect, createMemo, createSignal, createUniqueId, on, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'

import { api } from '@/lib/api'

import { errorText } from './components/console-ui'

import './terminal.css'

/** One row of the transcript. The view never invents output: each row is either
 * something the person typed or bytes the machine returned. */
interface TermLine {
  kind: 'command' | 'stdout' | 'stderr' | 'info' | 'error'
  text?: string
  prompt?: string
}

export interface TerminalProps {
  sandboxId: string
  /** Short handle for the prompt when no friendly host is given. */
  shortId: string
  /** The name shown before `@`; the machine's own shell prompt uses the same one. */
  promptUser?: string
  /** The friendly host shown after `@`, e.g. `rox-computer-medium-8G-2x4`. */
  promptHost?: string
  /** Exec only works on a running machine; the parent reports that state. */
  enabled: boolean
  disabledReason?: string
  /** False while another tab hides the panel: full screen must not stay open. */
  visible?: boolean
}

const TIMEOUT_SEC = 15
/** The PTY bridge is off in this build; commands run through exec with cwd tracking. */
const USE_PERSISTENT_SESSION = false

/** The customer's home inside the machine. Every label shows it as `~`; the
 * full path only ever travels on the wire, so it never becomes visible text. */
const SANDBOX_HOME = '/home/rox'
/** The product's name for the same directory: Rox's machine, Rox's home. */
const ROX_HOME = SANDBOX_HOME
/** An older image or a session opened before the move may still report the
 * previous home; it is the same place for the person and prints as `~` too. */
const LEGACY_HOME = '/home/daytona'
/** Both spellings of the one home; every one of them prints as `~`. */
const HOME_DIRS: readonly string[] = [ROX_HOME, LEGACY_HOME]
/** The prompt is the product's own: it reads the same on every machine, and an
 * image or account name never reaches it. */
const DEFAULT_PROMPT_USER = 'rox'
const DEFAULT_PROMPT_HOST = 'rox-computer'

interface QuickCommand {
  label: string
  command: string
  /** Downloads need longer than an ordinary probe is allowed to take. */
  timeoutSec?: number
  /** Run through plain exec: the persistent session waits only 15 s for an
   * answer, so a download started there is cut off before it can finish. */
  direct?: boolean
}

/** How one run should reach the machine when a button asks for it. */
interface RunOptions {
  timeoutSec?: number
  direct?: boolean
}

const QUICK_COMMANDS: readonly QuickCommand[] = [
  { label: 'uname -a', command: 'uname -a' },
  { label: 'ls -la', command: 'ls -la' },
  { label: 'pwd', command: 'pwd' },
  { label: 'python3 --version', command: 'python3 --version' },
  { label: 'df -h', command: 'df -h' },
]

/** One-click installs: the exact command each vendor publishes. */
const INSTALL_COMMANDS: readonly QuickCommand[] = [
  {
    label: 'OpenCode',
    command: 'curl -fsSL https://opencode.ai/install | bash',
    timeoutSec: 300,
    direct: true,
  },
  { label: 'OMP', command: 'curl -fsSL https://omp.sh/install | sh', timeoutSec: 300, direct: true },
]

/** A real request to the outside world; a blocked egress shows as curl's own
 * error on stderr and a non-zero code, which is the honest answer. */
const NETWORK_CHECK: QuickCommand = {
  label: 'Проверить сеть',
  command:
    "curl -fsS -m 15 -o /dev/null -w 'сеть есть: %{http_code}, %{time_total} с\\n' https://opencode.ai",
  timeoutSec: 30,
  direct: true,
}

/** Control bytes the panel cannot draw. The session server sometimes hands back
 * a bare `[0;2m` whose ESC is already gone, so colour codes are stripped with
 * and without their ESC prefix. Nothing else on the line is rewritten. */
const OSC_SEQUENCE = /\x1b\][^\u0007\x1b]*(?:\u0007|\x1b\\)/g
const CSI_SEQUENCE = /\x1b\[[0-?]*[ -/]*[@-~]/g
const OTHER_ESCAPE = /\x1b[@-_]/g
const BARE_SGR = /\[[0-9;]*m/g

function cleanOutput(text: string): string {
  return text
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(OTHER_ESCAPE, '')
    .replace(BARE_SGR, '')
    .replace(/\r\n/g, '\n')
}

/** A carriage return sends the cursor back to the start of the line, so only the
 * text after the last one is still on screen; progress bars collapse to their
 * final state instead of repeating every step. */
function visibleLine(text: string): string {
  const parts = text.split('\r')
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part !== undefined && part.length > 0) return part
  }
  return ''
}

function helpLines(session: boolean): TermLine[] {
  return [
    { kind: 'info', text: 'clear — очистить экран' },
    { kind: 'info', text: 'help — эта подсказка' },
    { kind: 'info', text: 'cd <каталог> — перейти в каталог; без каталога — в домашний ~' },
    { kind: 'info', text: '↑ и ↓ — история команд, Ctrl+L — очистка экрана' },
    {
      kind: 'info',
      text: session
        ? 'Сеанс постоянный: cd меняет каталог для следующих команд, «Прервать» останавливает долгую команду.'
        : 'Каждая команда выполняется на машине отдельно; cd запоминается только в этом окне.',
    },
  ]
}

/** stdout/stderr as rows; a trailing newline does not create an empty row.
 * Colour codes are removed and each line shows what a real terminal would still
 * display, so no raw escape sequence or progress-bar repetition reaches the eye. */
function outputLines(kind: 'stdout' | 'stderr', text: string): TermLine[] {
  const clean = cleanOutput(text)
  if (clean.length === 0) return []
  const parts = clean.split('\n')
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop()
  return parts.map((part) => ({ kind, text: visibleLine(part) }))
}

/** A quiet, human hint after a common failure; the real output stays above it. */
function friendlyNote(stdout: string, stderr: string): string | null {
  const text = `${stdout}\n${stderr}`
  const packageMiss = /E: Unable to locate package ([A-Za-z0-9.+_-]+)/.exec(text)
  if (packageMiss !== null) {
    return `В образе нет пакета ${packageMiss[1]}. Проверьте название или соберите его из исходников.`
  }
  const commandMiss = /(?:^|\n)(?:bash: |sh: )?(?:line \d+: )?([A-Za-z0-9._+-]+): command not found/.exec(text)
  if (commandMiss !== null) {
    return `${commandMiss[1]} не установлен на машине. Установите его или запустите другой инструмент.`
  }
  if (/Permission denied/i.test(text)) {
    return 'Машина отказала в доступе. Для системного файла или службы запустите команду через sudo.'
  }
  return null
}

/** Success says nothing; a failure is a clear red line with its code; an answer
 * that carries no code stays a quiet note instead of pretending to be success. */
function exitLines(code: number | null): TermLine[] {
  if (code === 0) return []
  if (code === null) return [{ kind: 'info', text: 'Код выхода не сообщён.' }]
  return [{ kind: 'error', text: `Команда завершилась с кодом ${code}.` }]
}

function lineText(line: TermLine): string {
  if (line.kind === 'command') return `${line.prompt ?? ''} ${line.text ?? ''}`.trimEnd()
  return line.text ?? ''
}

/**
 * An honest terminal over `exec` and one optional persistent session. A session
 * keeps `cd` between commands; when it cannot be opened every line falls back to
 * a separate call and the directory lives here. `clear`, `help` stay local;
 * nothing on screen is made up.
 */
export default function Terminal(props: TerminalProps): JSX.Element {
  const [lines, setLines] = createSignal<TermLine[]>([])
  const [history, setHistory] = createSignal<string[]>([])
  const [cwd, setCwd] = createSignal(SANDBOX_HOME)
  const [command, setCommand] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [full, setFull] = createSignal(false)
  const [copied, setCopied] = createSignal(false)
  const [sessionReady, setSessionReady] = createSignal(false)
  /** True only while the command in flight actually runs inside the session, so
   * «Прервать» never offers to stop a download that goes around it. */
  const [sessionRun, setSessionRun] = createSignal(false)

  const inputId = createUniqueId()
  let inputEl: HTMLInputElement | undefined
  let outputEl: HTMLDivElement | undefined
  let historyCursor: number | null = null
  let draftBeforeHistory = ''
  let copyTimer: number | undefined
  /** `sandboxId` whose persistent session is open, or null in plain exec mode. */
  let sessionSandbox: string | null = null
  /** Bumped on every start/stop request so a stale answer is ignored. */
  let sessionToken = 0
  /** Whether the latest state still asks for a session on `currentSandbox`. */
  let sessionWanted = false
  /** The exec-mode explanation is shown once per mounted panel, not per retry. */
  let execNoticeShown = false
  /** A failed session call after «Прервать» must not be replayed through exec. */
  let interruptRequested = false
  /** How many commands already reached the machine; keeps a late session start
   * from silently moving a directory the person set through plain exec. */
  let commandsRun = 0
  let currentSandbox = props.sandboxId

  // Shell shorthand for the home directory, the full path everywhere else.
  const promptCwd = (): string => {
    const current = cwd()
    for (const home of HOME_DIRS) {
      if (current === home) return '~'
      if (current.startsWith(home) && current.charAt(home.length) === '/') {
        return `~${current.slice(home.length)}`
      }
    }
    return current
  }

  const promptText = (): string =>
    `${props.promptUser ?? DEFAULT_PROMPT_USER}@${props.promptHost ?? DEFAULT_PROMPT_HOST}:${promptCwd()}$`

  const append = (added: TermLine[]): void => {
    if (added.length === 0) return
    setLines((list) => [...list, ...added])
  }

  const clearScreen = (): void => {
    setLines([])
  }

  const clearCopyTimer = (): void => {
    if (copyTimer !== undefined) {
      window.clearTimeout(copyTimer)
      copyTimer = undefined
    }
  }

  // Keep the newest output in view; also re-anchor after a resize to full screen.
  createEffect(() => {
    lines()
    full()
    const element = outputEl
    if (element !== undefined) element.scrollTop = element.scrollHeight
  })

  // Full screen owns the page scroll while it is open, and must collapse when a
  // tab switch hides the panel: a hidden fixed panel would keep the page locked.
  createEffect(() => {
    if (props.visible === false) setFull(false)
    document.body.classList.toggle('terminal-full-lock', full())
  })

  const stopActiveSession = (): void => {
    const previous = sessionSandbox
    sessionSandbox = null
    if (previous !== null) {
      void api.sessionStop(previous).catch(() => undefined)
    }
  }

  const noteExecMode = (): void => {
    if (execNoticeShown) return
    execNoticeShown = true
    append([
      {
        kind: 'info',
        text: 'Постоянный сеанс недоступен — команды выполняются по одной, каталог запоминается в этом окне.',
      },
    ])
  }

  // One persistent session per running machine; a stopped machine, a replaced
  // machine or an unmounted panel closes it. A failed start is not an error the
  // person must solve: the panel simply keeps working one command at a time.
  const sessionKey = createMemo(() => `${props.sandboxId}:${props.enabled}`)
  createEffect(on(sessionKey, () => {
    const id = props.sandboxId
    const enabled = props.enabled
    const token = ++sessionToken
    sessionWanted = enabled
    if (id !== currentSandbox) {
      currentSandbox = id
      commandsRun = 0
      setCwd(SANDBOX_HOME)
    }
    stopActiveSession()
    setSessionReady(false)
    if (!enabled || !USE_PERSISTENT_SESSION) return
    void (async () => {
      try {
        const session = await api.sessionStart(id)
        if (token !== sessionToken) {
          // A newer state owns the machine now; only a start nobody wants any
          // more may close what it opened.
          if (!sessionWanted || currentSandbox !== id) {
            void api.sessionStop(id).catch(() => undefined)
          }
          return
        }
        if (session.state !== 'ready') {
          noteExecMode()
          return
        }
        sessionSandbox = id
        setSessionReady(true)
        if (commandsRun === 0 && typeof session.cwd === 'string' && session.cwd.length > 0) {
          setCwd(session.cwd)
        }
      } catch {
        if (token !== sessionToken) return
        noteExecMode()
      }
    })()
  }))

  onCleanup(() => {
    sessionWanted = false
    sessionToken += 1
    // The shell belongs to the machine, not to this mount: a reload or a
    // second tab must not kill the session the next page is about to reuse.
    document.body.classList.remove('terminal-full-lock')
    clearCopyTimer()
  })

  const remember = (value: string): void => {
    if (value.length === 0) return
    setHistory((list) => (list[list.length - 1] === value ? list : [...list, value]))
  }

  const goFull = (value: boolean): void => {
    setFull(value)
    window.setTimeout(() => {
      const element = inputEl
      if (element !== undefined) element.focus()
    }, 0)
  }

  const previousCommand = (): void => {
    const list = history()
    if (list.length === 0) return
    if (historyCursor === null) {
      draftBeforeHistory = command()
      historyCursor = list.length - 1
    } else if (historyCursor > 0) {
      historyCursor -= 1
    } else {
      return
    }
    const value = list[historyCursor]
    if (value !== undefined) setCommand(value)
  }

  const nextCommand = (): void => {
    const list = history()
    if (historyCursor === null) return
    if (historyCursor < list.length - 1) {
      historyCursor += 1
      const value = list[historyCursor]
      if (value !== undefined) setCommand(value)
      return
    }
    historyCursor = null
    setCommand(draftBeforeHistory)
  }

  /** One-shot exec: plain mode and the fallback when a session dies. */
  const execOnce = async (raw: string, timeoutSec = TIMEOUT_SEC): Promise<void> => {
    // `cd` is a shell builtin: it cannot outlive the exec call, so the new
    // directory is read back from `pwd` and kept in this component instead.
    // Only a plain path (optionally quoted) counts; a line with `;` or `|`
    // stays an ordinary command so the prompt is never moved by its output.
    const cdMatch = /^cd(?:\s+("[^"]*"|'[^']*'|[^\s;&|<>()`]+))?$/.exec(raw)
    const wire =
      cdMatch === null ? raw : cdMatch[1] === undefined ? 'cd && pwd' : `cd ${cdMatch[1]} && pwd`
    const result = await api.exec(props.sandboxId, {
      command: wire,
      cwd: cwd(),
      timeoutSec,
    })
    const output = [
      ...outputLines('stdout', result.stdout),
      ...outputLines('stderr', result.stderr),
    ]
    append(output.length === 0 ? [{ kind: 'info', text: 'вывода нет' }] : output)
    const hint = friendlyNote(result.stdout, result.stderr)
    if (hint !== null) append([{ kind: 'info', text: hint }])
    if (cdMatch !== null && result.exitCode === 0) {
      const target = cleanOutput(result.stdout)
        .split('\n')
        .map((line) => visibleLine(line).trim())
        .find((line) => line.length > 0)
      if (target !== undefined) setCwd(target)
    }
    append(exitLines(result.exitCode))
  }

  /** The session keeps its own directory on the machine, so `cd` goes as typed
   * and the directory that took effect comes back in the answer. */
  const sessionOnce = async (raw: string): Promise<void> => {
    const result = await api.sessionExec(props.sandboxId, raw)
    const output = [
      ...outputLines('stdout', result.stdout),
      ...outputLines('stderr', result.stderr),
    ]
    append(output.length === 0 ? [{ kind: 'info', text: 'вывода нет' }] : output)
    const hint = friendlyNote(result.stdout, result.stderr)
    if (hint !== null) append([{ kind: 'info', text: hint }])
    if (typeof result.cwd === 'string' && result.cwd.length > 0) setCwd(result.cwd)
    append(exitLines(result.exitCode))
  }

  const run = async (rawInput: string, options?: RunOptions): Promise<void> => {
    const raw = rawInput.trim()
    if (busy() || !props.enabled) return
    historyCursor = null
    draftBeforeHistory = ''

    if (raw === 'clear') {
      remember(raw)
      clearScreen()
      setCommand('')
      return
    }

    remember(raw)
    append([{ kind: 'command', prompt: promptText(), text: raw }])
    setCommand('')
    if (raw === '') return

    if (raw === 'help') {
      append(helpLines(sessionReady()))
      return
    }

    setBusy(true)
    commandsRun += 1
    interruptRequested = false
    try {
      // A long download must not enter the session: that wait is short, and an
      // answer arriving after it says nothing about the download still running.
      if (sessionReady() && options?.direct !== true) {
        setSessionRun(true)
        try {
          await sessionOnce(raw)
          return
        } catch (error) {
          if (interruptRequested) {
            append([{ kind: 'info', text: 'Команда прервана.' }])
            return
          }
          stopActiveSession()
          setSessionReady(false)
          append([
            {
              kind: 'info',
              text: `Постоянный сеанс прервался (${errorText(error)}). Команда выполнена обычным способом.`,
            },
          ])
        }
      }
      await execOnce(raw, options?.timeoutSec)
    } catch (error) {
      append([{ kind: 'error', text: errorText(error) }])
    } finally {
      interruptRequested = false
      setSessionRun(false)
      setBusy(false)
      const element = inputEl
      if (element !== undefined) element.focus()
    }
  }

  const interrupt = async (): Promise<void> => {
    if (!busy() || !sessionRun()) return
    interruptRequested = true
    try {
      await api.sessionInterrupt(props.sandboxId)
      append([{ kind: 'info', text: 'Запрошено прерывание команды.' }])
    } catch (error) {
      interruptRequested = false
      append([{ kind: 'error', text: errorText(error) }])
    }
  }

  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    void run(command())
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey && event.key.toLowerCase() === 'l') {
      event.preventDefault()
      clearScreen()
      return
    }
    if (event.key === 'Escape' && full()) {
      event.preventDefault()
      goFull(false)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      previousCommand()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      nextCommand()
    }
  }

  const copyAll = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(lines().map(lineText).join('\n'))
      setCopied(true)
      clearCopyTimer()
      copyTimer = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      append([{ kind: 'error', text: 'Не удалось скопировать: браузер не дал доступ к буферу обмена.' }])
    }
  }

  return (
    <section
      class="terminal"
      classList={{ 'terminal-full': full() }}
      aria-label="Терминал машины"
      onKeyDown={onKeyDown}
    >
      <header class="terminal-head">
        <span class="terminal-title">Терминал</span>
        <Show when={sessionReady()}>
          <span
            class="terminal-mode is-session"
            title="Постоянный сеанс: команды идут в один сеанс на машине, cd меняет каталог для следующих команд."
          >
            Постоянный сеанс
          </span>
        </Show>
        <Show when={busy()}>
          <span class="terminal-busy" role="status">
            Выполняется…
          </span>
        </Show>
        <Show when={copied()}>
          <span class="sr-only" role="status">
            Транскрипт скопирован
          </span>
        </Show>
        <div class="terminal-tools">
          <Show when={busy() && sessionRun()}>
            <button
              type="button"
              class="terminal-tool terminal-tool-interrupt"
              onClick={() => void interrupt()}
            >
              Прервать
            </button>
          </Show>
          <button
            type="button"
            class="terminal-tool"
            onClick={() => void copyAll()}
            disabled={lines().length === 0}
          >
            {copied() ? 'Скопировано' : 'Копировать всё'}
          </button>
          <button
            type="button"
            class="terminal-tool"
            onClick={() => clearScreen()}
            disabled={lines().length === 0}
          >
            Очистить
          </button>
          <button
            type="button"
            class="terminal-tool"
            aria-pressed={full() ? 'true' : 'false'}
            onClick={() => goFull(!full())}
          >
            {full() ? 'Свернуть' : 'Развернуть'}
          </button>
        </div>
      </header>

      <Show when={!props.enabled}>
        <div class="terminal-blocked" role="status">
          {props.disabledReason ?? 'Терминал работает только на запущенной машине.'}
        </div>
      </Show>

      <div
        ref={outputEl}
        class="terminal-output"
        role="log"
        aria-live="polite"
        aria-busy={busy() ? 'true' : 'false'}
        aria-label="Вывод терминала"
        tabindex="0"
      >
        <Show when={lines().length === 0}>
          <div class="terminal-hint">
            <span>Введите команду и нажмите Enter.</span>
            <span>help — особые команды, clear и Ctrl+L — очистка экрана.</span>
            <span>OpenCode и OMP ставятся кнопками в строке «Установка».</span>
          </div>
        </Show>
        <For each={lines()}>
          {(line) => (
            <div
              class="terminal-line"
              classList={{
                'terminal-line-command': line.kind === 'command',
                'terminal-line-stdout': line.kind === 'stdout',
                'terminal-line-stderr': line.kind === 'stderr',
                'terminal-line-info': line.kind === 'info',
                'terminal-line-error': line.kind === 'error',
              }}
            >
              <Show when={line.kind === 'command'}>
                <span class="terminal-prompt-inline">{line.prompt}</span>{' '}
              </Show>
              <span class="terminal-text">{line.text}</span>
            </div>
          )}
        </For>
      </div>

      <div class="terminal-quick" role="group" aria-label="Быстрые команды">
        <span class="terminal-quick-label">Быстро:</span>
        <For each={QUICK_COMMANDS}>
          {(quick) => (
            <button
              type="button"
              class="terminal-quick-command"
              title={quick.command}
              disabled={!props.enabled || busy()}
              onClick={() => void run(quick.command)}
            >
              {quick.label}
            </button>
          )}
        </For>
      </div>

      <div
        class="terminal-quick terminal-quick-install"
        role="group"
        aria-label="Установка и проверка сети"
      >
        <span class="terminal-quick-label">Установка:</span>
        <For each={INSTALL_COMMANDS}>
          {(item) => (
            <button
              type="button"
              class="terminal-quick-command terminal-quick-install-command"
              title={item.command}
              disabled={!props.enabled || busy()}
              onClick={() =>
                void run(item.command, { timeoutSec: item.timeoutSec, direct: item.direct })
              }
            >
              {item.label}
            </button>
          )}
        </For>
        <button
          type="button"
          class="terminal-quick-command"
          title={NETWORK_CHECK.command}
          disabled={!props.enabled || busy()}
          onClick={() =>
            void run(NETWORK_CHECK.command, {
              timeoutSec: NETWORK_CHECK.timeoutSec,
              direct: NETWORK_CHECK.direct,
            })
          }
        >
          {NETWORK_CHECK.label}
        </button>
      </div>

      <form class="terminal-input-row" onSubmit={submit}>
        <label class="sr-only" for={inputId}>
          Команда для машины, каталог {promptCwd()}
        </label>
        <span class="terminal-prompt" aria-hidden="true" title={promptText()}>
          {promptText()}
        </span>
        <input
          id={inputId}
          ref={inputEl}
          class="terminal-input"
          type="text"
          value={command()}
          placeholder="Введите команду, например uname -a"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          enterkeyhint="send"
          disabled={!props.enabled}
          readOnly={busy()}
          onInput={(event) => setCommand(event.currentTarget.value)}
        />
        <button
          type="submit"
          class="terminal-run"
          disabled={!props.enabled || busy()}
        >
          Выполнить
        </button>
      </form>
    </section>
  )
}

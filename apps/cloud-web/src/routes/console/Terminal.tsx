import { For, Show, createEffect, createSignal, createUniqueId, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'

import { api } from '@/lib/api'

import { errorText } from './components/console-ui'

import './terminal.css'

/** One row of the transcript. The view never invents output: each row is either
 * something the person typed or bytes the machine returned. */
interface TermLine {
  kind: 'command' | 'stdout' | 'stderr' | 'info' | 'error' | 'exit'
  text?: string
  prompt?: string
  code?: number | null
}

export interface TerminalProps {
  sandboxId: string
  /** Short handle for the prompt: `daytona@<short>:<cwd>$`. */
  shortId: string
  /** Exec only works on a running machine; the parent reports that state. */
  enabled: boolean
  disabledReason?: string
  /** False while another tab hides the panel: full screen must not stay open. */
  visible?: boolean
}

const TIMEOUT_SEC = 15

/** The Daytona image runs as `daytona` (uid 1001) and its home is here; `/root`
 * exists but is not readable, so exec must never start there. */
const SANDBOX_USER = 'daytona'
const SANDBOX_HOME = '/home/daytona'

const QUICK_COMMANDS: readonly string[] = [
  'uname -a',
  'ls -la',
  'pwd',
  'python3 --version',
  'df -h',
]

const HELP_LINES: readonly TermLine[] = [
  { kind: 'info', text: 'clear — очистить экран' },
  { kind: 'info', text: 'help — эта подсказка' },
  { kind: 'info', text: 'cd <каталог> — перейти в каталог; без каталога — в домашний /home/daytona' },
  { kind: 'info', text: '↑ и ↓ — история команд, Ctrl+L — очистка экрана' },
  {
    kind: 'info',
    text: 'Каждая команда выполняется на машине отдельно: постоянного сеанса здесь нет.',
  },
]

/** stdout/stderr as rows; a trailing newline does not create an empty row. */
function outputLines(kind: 'stdout' | 'stderr', text: string): TermLine[] {
  if (text.length === 0) return []
  const parts = text.replace(/\r\n/g, '\n').split('\n')
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop()
  return parts.map((part) => ({ kind, text: part }))
}

function exitText(code: number | null): string {
  return code === null ? 'код выхода не сообщён' : `код выхода ${code}`
}

function lineText(line: TermLine): string {
  if (line.kind === 'command') return `${line.prompt ?? ''} ${line.text ?? ''}`.trimEnd()
  if (line.kind === 'exit') return `[${exitText(line.code ?? null)}]`
  return line.text ?? ''
}

/**
 * An honest terminal over `exec`: every line is one API call, the current
 * directory lives here, and nothing on screen is made up. `clear`, `help` and
 * `cd` are handled locally; everything else goes to the machine unchanged.
 */
export default function Terminal(props: TerminalProps): JSX.Element {
  const [lines, setLines] = createSignal<TermLine[]>([])
  const [history, setHistory] = createSignal<string[]>([])
  const [cwd, setCwd] = createSignal(SANDBOX_HOME)
  const [command, setCommand] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [full, setFull] = createSignal(false)
  const [copied, setCopied] = createSignal(false)

  const inputId = createUniqueId()
  let inputEl: HTMLInputElement | undefined
  let outputEl: HTMLDivElement | undefined
  let historyCursor: number | null = null
  let draftBeforeHistory = ''
  let copyTimer: number | undefined

  // Shell shorthand for the home directory, the full path everywhere else.
  const promptCwd = (): string => {
    const current = cwd()
    if (current === SANDBOX_HOME) return '~'
    if (current.startsWith(`${SANDBOX_HOME}/`)) return `~${current.slice(SANDBOX_HOME.length)}`
    return current
  }

  const promptText = (): string => `${SANDBOX_USER}@${props.shortId}:${promptCwd()}$`

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
  onCleanup(() => {
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

  const run = async (rawInput: string): Promise<void> => {
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
      append([...HELP_LINES])
      return
    }

    // `cd` is a shell builtin: it cannot outlive the exec call, so the new
    // directory is read back from `pwd` and kept in this component instead.
    // Only a plain path (optionally quoted) counts; a line with `;` or `|`
    // stays an ordinary command so the prompt is never moved by its output.
    const cdMatch = /^cd(?:\s+("[^"]*"|'[^']*'|[^\s;&|<>()`]+))?$/.exec(raw)
    const wire =
      cdMatch === null ? raw : cdMatch[1] === undefined ? 'cd && pwd' : `cd ${cdMatch[1]} && pwd`

    setBusy(true)
    try {
      const result = await api.exec(props.sandboxId, {
        command: wire,
        cwd: cwd(),
        timeoutSec: TIMEOUT_SEC,
      })
      append([
        ...outputLines('stdout', result.stdout),
        ...outputLines('stderr', result.stderr),
      ])
      if (result.stdout.length === 0 && result.stderr.length === 0) {
        append([{ kind: 'info', text: 'вывода нет' }])
      }
      if (cdMatch !== null && result.exitCode === 0) {
        const target = result.stdout
          .replace(/\r\n/g, '\n')
          .split('\n')
          .map((line) => line.trim())
          .find((line) => line.length > 0)
        if (target !== undefined) setCwd(target)
      }
      append([{ kind: 'exit', code: result.exitCode }])
    } catch (error) {
      append([{ kind: 'error', text: errorText(error) }])
    } finally {
      setBusy(false)
      const element = inputEl
      if (element !== undefined) element.focus()
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
                'terminal-line-exit': line.kind === 'exit',
                'is-failed': line.kind === 'exit' && typeof line.code === 'number' && line.code > 0,
              }}
            >
              <Show when={line.kind === 'command'}>
                <span class="terminal-prompt-inline">{line.prompt}</span>{' '}
              </Show>
              <span class="terminal-text">
                {line.kind === 'exit' ? exitText(line.code ?? null) : line.text}
              </span>
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
              disabled={!props.enabled || busy()}
              onClick={() => void run(quick)}
            >
              {quick}
            </button>
          )}
        </For>
      </div>

      <form class="terminal-input-row" onSubmit={submit}>
        <label class="sr-only" for={inputId}>
          Команда для машины, каталог {cwd()}
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

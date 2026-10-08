import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { parseAnsi } from '@rox/ui'
import { toErrorMessage } from '@/lib/errors'

/**
 * Inspector command surface. Uses /bin/zsh -lc via IPC when available;
 * otherwise keeps a local transcript so the dock is usable immediately.
 */
export function InspectorTerminal({ cwd, autoFocus = false }: { cwd?: string; autoFocus?: boolean }) {
  const { t } = useTranslation()
  const [cmd, setCmd] = React.useState('')
  const [log, setLog] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState(false)
  const scroller = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [log])

  const run = React.useCallback(async () => {
    const line = cmd.trim()
    if (!line || busy) return
    setCmd('')
    setLog((prev) => [...prev, `$ ${line}`])
    setBusy(true)
    try {
      if (!window.electronAPI.runShellCommand) {
        setLog((prev) => [...prev, t('inspector.terminalNoBridge')])
        return
      }
      const result = await window.electronAPI.runShellCommand({ command: line, cwd })
      const out = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
      setLog((prev) => [...prev, out || (result.ok ? '' : t('inspector.terminalFailed'))])
    } catch (err) {
      setLog((prev) => [...prev, toErrorMessage(err)])
    } finally {
      setBusy(false)
    }
  }, [busy, cmd, cwd, t])

  return (
    <div
      className="rox-inspector-terminal flex min-h-0 flex-1 flex-col overflow-hidden"
      style={{
        backgroundColor: 'var(--terminal-background, #111214)',
        color: 'var(--terminal-foreground, #e8e8ea)',
      }}
    >
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-5">
        {/* One prompt only: the hint lives in the input placeholder below. */}
        {log.map((line, i) => (
          <pre
            key={i}
            className={cn('whitespace-pre-wrap break-all', line.startsWith('$ ') && 'opacity-80')}
          >
            {parseAnsi(line, { themeAware: true }).map((span, index) => (
              <span key={index} style={{ color: span.fg, backgroundColor: span.bg, fontWeight: span.bold ? 'bold' : undefined }}>
                {span.text}
              </span>
            ))}
          </pre>
        ))}
      </div>
      <form
        className="rox-terminal-prompt flex shrink-0 items-center gap-2 px-2 py-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          void run()
        }}
      >
        <span className="text-[11px] opacity-40">$</span>
        <input
          value={cmd}
          onChange={(event) => setCmd(event.target.value)}
          disabled={busy}
          // Focus only when the user explicitly opened the terminal, so the
          // resting state at launch is flat (no focus indicator).
          autoFocus={autoFocus}
          spellCheck={false}
          aria-label={t('inspector.terminalPlaceholder')}
          style={{ caretColor: 'var(--terminal-cursor, currentColor)' }}
          className="rox-terminal-input h-7 min-w-0 flex-1 bg-transparent font-mono text-[12px] outline-none placeholder:opacity-30"
          placeholder={busy ? t('common.loading') : t('inspector.terminalHint')}
        />
      </form>
    </div>
  )
}

import * as React from 'react'
import { SquareTerminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

/**
 * Inspector command surface. Uses /bin/zsh -lc via IPC when available;
 * otherwise keeps a local transcript so the dock is usable immediately.
 */
export function InspectorTerminal({ cwd }: { cwd?: string }) {
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
      setLog((prev) => [...prev, err instanceof Error ? err.message : String(err)])
    } finally {
      setBusy(false)
    }
  }, [busy, cmd, cwd, t])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#111214] text-[#e8e8ea]">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-white/5 px-3 text-[11px] text-white/50">
        <SquareTerminal className="h-3.5 w-3.5" />
        <span className="truncate">{cwd || '~'}</span>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-5">
        {log.length === 0 ? (
          <div className="text-white/40">{t('inspector.terminalHint')}</div>
        ) : (
          log.map((line, i) => (
            <pre key={i} className={cn('whitespace-pre-wrap break-all', line.startsWith('$ ') && 'text-white/80')}>
              {line}
            </pre>
          ))
        )}
      </div>
      <form
        className="flex shrink-0 items-center gap-2 border-t border-white/5 px-2 py-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          void run()
        }}
      >
        <span className="text-[11px] text-white/40">$</span>
        <input
          value={cmd}
          onChange={(event) => setCmd(event.target.value)}
          disabled={busy}
          autoFocus
          spellCheck={false}
          className="h-7 min-w-0 flex-1 bg-transparent font-mono text-[12px] text-white outline-none placeholder:text-white/30"
          placeholder={busy ? t('common.loading') : t('inspector.terminalPlaceholder')}
        />
      </form>
    </div>
  )
}

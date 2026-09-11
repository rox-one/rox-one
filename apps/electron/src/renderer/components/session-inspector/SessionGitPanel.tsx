import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch } from 'lucide-react'
import type { GitWorkingTreeStatus } from '@craft-agent/shared/git/status'
import { emptyGitWorkingTreeStatus } from '@craft-agent/shared/git/status'
import { cn } from '@/lib/utils'

export function SessionGitPanel({ cwd }: { cwd: string | undefined }) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<GitWorkingTreeStatus>(emptyGitWorkingTreeStatus)

  useEffect(() => {
    let cancelled = false
    if (!cwd) {
      setStatus(emptyGitWorkingTreeStatus())
      return
    }
    void window.electronAPI.getGitStatus?.(cwd).then((next) => {
      if (!cancelled) setStatus(next)
    }).catch(() => {
      if (!cancelled) setStatus(emptyGitWorkingTreeStatus())
    })
    return () => { cancelled = true }
  }, [cwd])

  if (!cwd || !status.isRepo) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <GitBranch className="h-6 w-6 text-muted-foreground/40" />
        <span className="text-[13px] text-muted-foreground/70">{t('inspector.git.notRepo')}</span>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2 text-[12px]">
      <div className="mb-2 font-medium text-foreground/90">
        {t('inspector.git.branch')}: {status.branch ?? '—'}
        {status.ahead > 0 ? ` +${status.ahead}` : ''}
        {status.behind > 0 ? ` -${status.behind}` : ''}
      </div>
      {status.entries.length === 0 ? (
        <span className="text-muted-foreground/60">{t('inspector.git.empty')}</span>
      ) : (
        <ul className="flex flex-col gap-1 font-mono">
          {status.entries.map((entry) => (
            <li key={entry.path} className={cn('truncate text-foreground/80')}>
              <span className="text-muted-foreground/70">{entry.index}{entry.worktree}</span>
              {' '}
              {entry.path}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

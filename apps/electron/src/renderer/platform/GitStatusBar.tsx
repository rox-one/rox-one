import * as React from 'react'
import { AlertCircle, GitBranch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useWorkspaceGitModel } from '@/hooks/useWorkspaceGitModel'
import { useSuperEngineeringProfile } from '@/hooks/useSuperEngineeringProfile'

export interface GitStatusBarProps {
  workspaceRootPath?: string | null
  className?: string
}

export function GitStatusBar({ workspaceRootPath, className }: GitStatusBarProps) {
  const se = useSuperEngineeringProfile()
  const { t } = useTranslation()
  const git = useWorkspaceGitModel(workspaceRootPath)
  const [identityOpen, setIdentityOpen] = React.useState(false)
  const showIdentityError = identityOpen || Boolean(git.identityError)
  const identityNeedsAttention = Boolean(git.identityError)

  if (!se) return null

  return (
    <div
      className={cn(
        'mb-2 flex items-center justify-between gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-2.5 py-1.5 text-xs backdrop-blur-md',
        className,
      )}
      data-testid="git-status-bar"
    >
      <div className="flex min-w-0 items-center gap-2 text-foreground/85">
        <GitBranch className="size-3.5 shrink-0 opacity-70" aria-hidden />
        <span className="truncate font-medium">{git.currentBranch}</span>
        <span className="text-muted-foreground">
          {t('se.git.uncommitted', { count: git.dirtyFileCount })}
        </span>
      </div>
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1 hover:underline',
          identityNeedsAttention ? 'text-amber-400/90' : 'text-muted-foreground',
        )}
        onClick={() => setIdentityOpen((open) => !open)}
        data-testid="git-identity-stub"
        aria-pressed={showIdentityError}
      >
        <AlertCircle className="size-3.5" aria-hidden />
        {showIdentityError ? t('se.git.identityStub') : t('se.git.configure')}
      </button>
    </div>
  )
}

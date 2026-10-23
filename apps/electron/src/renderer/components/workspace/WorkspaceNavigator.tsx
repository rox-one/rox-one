import * as React from 'react'
import { useAtomValue } from 'jotai'
import { FolderGit2, GitBranch, GitPullRequest } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { seLeftSidebarLayoutAtom } from '@/atoms/workbench-layout'
import { useWorkspaceGitModel } from '@/hooks/useWorkspaceGitModel'
import { WorktreeHoverCard } from './WorktreeHoverCard'

/** Spec §3 compact hover: reveal git/PR card after 200–300ms (midpoint). */
export const WORKTREE_HOVER_DELAY_MS = 250

export interface WorkspaceNavigatorProps {
  workspaceRootPath?: string | null
  className?: string
}

export function WorkspaceNavigator({ workspaceRootPath, className }: WorkspaceNavigatorProps) {
  const { t } = useTranslation()
  const layout = useAtomValue(seLeftSidebarLayoutAtom)
  const git = useWorkspaceGitModel(workspaceRootPath)
  const [hoverBranchId, setHoverBranchId] = React.useState<string | null>(null)
  const openTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverBranch = git.branches.find((b) => b.id === hoverBranchId) ?? null

  const clearOpenTimer = React.useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current)
      openTimer.current = null
    }
  }, [])

  React.useEffect(() => clearOpenTimer, [clearOpenTimer])

  React.useEffect(() => {
    if (layout !== 'compact') {
      clearOpenTimer()
      setHoverBranchId(null)
    }
  }, [layout, clearOpenTimer])

  const scheduleHover = (branchId: string) => {
    if (layout !== 'compact') return
    clearOpenTimer()
    openTimer.current = setTimeout(() => {
      openTimer.current = null
      setHoverBranchId(branchId)
    }, WORKTREE_HOVER_DELAY_MS)
  }

  const clearHover = () => {
    clearOpenTimer()
    setHoverBranchId(null)
  }

  return (
    <section
      className={cn('mx-2 mb-1', className)}
      data-testid="workspace-navigator"
      data-layout={layout}
      aria-label={t('se.workspace.navigator')}
    >
      {/* One compact 32px row: repo name + muted inline dirty-count badge. */}
      <header className="flex h-8 items-center gap-2 rounded-[var(--radius-control)] px-2 text-caption text-text-secondary">
        <FolderGit2 className="icon-caption shrink-0 opacity-60" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium" title={git.repoLabel}>{git.repoLabel}</span>
        <span
          className="inline-flex shrink-0 items-center gap-0.5 rounded bg-surface-hover px-1 text-mark text-muted-foreground numeric"
          title={t('se.workspace.dirtyCount', { count: git.dirtyFileCount })}
          aria-label={t('se.workspace.dirtyCount', { count: git.dirtyFileCount })}
          data-testid="workspace-dirty-count"
        >
          <GitPullRequest className="icon-status" aria-hidden />
          {git.dirtyFileCount}
        </span>
      </header>
      <div className="space-y-0.5">
        {git.branches.map((branch) => (
          <div
            key={branch.id}
            className="relative"
            onMouseEnter={() => scheduleHover(branch.id)}
            onMouseLeave={clearHover}
          >
            <button
              type="button"
              data-glass-slot="row"
              data-state={branch.isCurrent ? 'selected' : undefined}
              className={cn(
                'flex h-7 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-caption',
                branch.isCurrent ? 'bg-white/6 text-foreground' : 'text-foreground/80 hover:bg-white/4',
              )}
              data-testid={`workspace-branch-${branch.id}`}
            >
              <GitBranch className="size-3.5 shrink-0 opacity-70" aria-hidden />
              <span className="min-w-0 flex-1 truncate" title={branch.name}>{branch.name}</span>
              {layout === 'detailed' && (
                <span className="shrink-0 text-xs text-emerald-400/90">+{branch.additions}</span>
              )}
              {layout === 'detailed' && (
                <span className="shrink-0 text-xs text-rose-400/90">-{branch.deletions}</span>
              )}
              {layout === 'detailed' && branch.ahead > 0 && (
                <span className="shrink-0 text-xs text-sky-400/90">↑{branch.ahead}</span>
              )}
              {layout === 'detailed' && branch.behind > 0 && (
                <span className="shrink-0 text-xs text-amber-400/90">↓{branch.behind}</span>
              )}
            </button>
            {layout === 'compact' && hoverBranch?.id === branch.id && (
              <div className="absolute left-full top-0 z-50 ml-2 w-48">
                <WorktreeHoverCard branch={branch} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { FolderGit2, GitBranch, GitPullRequest } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { seLeftSidebarLayoutAtom } from '@/atoms/workbench-layout'
import { useWorkspaceGitModel } from '@/hooks/useWorkspaceGitModel'
import { WorktreeHoverCard } from './WorktreeHoverCard'

export interface WorkspaceNavigatorProps {
  workspaceRootPath?: string | null
  className?: string
}

export function WorkspaceNavigator({ workspaceRootPath, className }: WorkspaceNavigatorProps) {
  const { t } = useTranslation()
  const layout = useAtomValue(seLeftSidebarLayoutAtom)
  const git = useWorkspaceGitModel(workspaceRootPath)
  const [hoverBranchId, setHoverBranchId] = React.useState<string | null>(null)
  const hoverBranch = git.branches.find((b) => b.id === hoverBranchId) ?? null

  return (
    <section
      className={cn('mx-1 mb-3 rounded-lg border border-white/5 bg-white/[0.02] px-2 py-2', className)}
      data-testid="workspace-navigator"
      data-layout={layout}
      aria-label={t('se.workspace.navigator')}
    >
      <header className="flex items-center gap-2 px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/50">
        <FolderGit2 className="size-3.5" aria-hidden />
        <span className="truncate">{git.repoLabel}</span>
      </header>
      <div className="space-y-1">
        {git.branches.map((branch) => (
          <div
            key={branch.id}
            className="relative"
            onMouseEnter={() => layout === 'compact' && setHoverBranchId(branch.id)}
            onMouseLeave={() => layout === 'compact' && setHoverBranchId(null)}
          >
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]',
                branch.isCurrent ? 'bg-white/6 text-foreground' : 'text-foreground/80 hover:bg-white/4',
              )}
              data-testid={`workspace-branch-${branch.id}`}
            >
              <GitBranch className="size-3.5 shrink-0 opacity-70" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{branch.name}</span>
              {layout === 'detailed' && (
                <span className="shrink-0 text-[11px] text-emerald-400/90">+{branch.additions}</span>
              )}
              {layout === 'detailed' && (
                <span className="shrink-0 text-[11px] text-rose-400/90">-{branch.deletions}</span>
              )}
              {layout === 'detailed' && branch.ahead > 0 && (
                <span className="shrink-0 text-[11px] text-sky-400/90">↑{branch.ahead}</span>
              )}
              {layout === 'detailed' && branch.behind > 0 && (
                <span className="shrink-0 text-[11px] text-amber-400/90">↓{branch.behind}</span>
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
      <footer className="mt-2 flex items-center gap-2 border-t border-white/5 px-1 pt-2 text-[11px] text-muted-foreground">
        <GitPullRequest className="size-3.5" aria-hidden />
        <span>{t('se.workspace.dirtyCount', { count: git.dirtyFileCount })}</span>
      </footer>
    </section>
  )
}

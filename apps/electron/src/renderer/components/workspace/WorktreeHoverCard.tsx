import * as React from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import type { WorkspaceGitBranch } from '@/hooks/useWorkspaceGitModel'
import { SE_SPRING_PANEL } from '@/lib/motion/super-engineering-springs'

export interface WorktreeHoverCardProps {
  branch: WorkspaceGitBranch
  className?: string
}

export function WorktreeHoverCard({ branch, className }: WorktreeHoverCardProps) {
  return (
    <motion.div
      role="tooltip"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SE_SPRING_PANEL}
      className={cn(
        'rounded-lg border border-white/10 bg-[color-mix(in_oklch,var(--paper)_92%,transparent)] px-3 py-2 text-xs shadow-lg backdrop-blur-md',
        className,
      )}
      data-testid="worktree-hover-card"
    >
      <div className="font-medium text-foreground">{branch.name}</div>
      <div className="mt-1 flex gap-3 text-muted-foreground">
        <span>+{branch.additions}</span>
        <span>-{branch.deletions}</span>
        {branch.ahead > 0 && <span>↑{branch.ahead}</span>}
        {branch.behind > 0 && <span>↓{branch.behind}</span>}
      </div>
    </motion.div>
  )
}

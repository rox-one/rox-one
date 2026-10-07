import type { ReactNode } from 'react'
import { useSuperEngineeringProfile } from '@/hooks/useSuperEngineeringProfile'

export type ShellLayoutModeId = 'rox-default' | 'se-workspace'

export interface ShellLayoutModeProps {
  workspaceRootPath?: string | null
  children: (mode: ShellLayoutModeId) => ReactNode
}

export function ShellLayoutMode({ workspaceRootPath, children }: ShellLayoutModeProps) {
  const se = useSuperEngineeringProfile()
  const hasWorkspace = Boolean(workspaceRootPath && workspaceRootPath.length > 0)
  const mode: ShellLayoutModeId = se && hasWorkspace ? 'se-workspace' : 'rox-default'
  return <>{children(mode)}</>
}

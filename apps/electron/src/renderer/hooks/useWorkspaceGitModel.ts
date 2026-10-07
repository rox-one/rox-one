import { useMemo } from 'react'

export type WorkspaceGitBranch = {
  id: string
  name: string
  ahead: number
  behind: number
  additions: number
  deletions: number
  isCurrent: boolean
}

export type WorkspaceGitModel = {
  repoLabel: string
  currentBranch: string
  dirtyFileCount: number
  identityError: string | null
  branches: readonly WorkspaceGitBranch[]
}

const MOCK_BRANCHES: WorkspaceGitBranch[] = [
  { id: 'main', name: 'main', ahead: 0, behind: 0, additions: 12, deletions: 4, isCurrent: true },
  { id: 'feat/se', name: 'feat/super-engineering-ui-parity', ahead: 3, behind: 0, additions: 128, deletions: 12, isCurrent: false },
  { id: 'fix', name: 'fix/inspector-edge', ahead: 0, behind: 2, additions: 6, deletions: 1, isCurrent: false },
]

/** UI-only git fixture until workspace git IPC is wired (SE wave 1). */
export function useWorkspaceGitModel(workspaceRootPath: string | null | undefined): WorkspaceGitModel {
  return useMemo(() => {
    const label = workspaceRootPath?.split('/').filter(Boolean).pop() ?? 'workspace'
    return {
      repoLabel: label,
      currentBranch: 'feat/super-engineering-ui-parity',
      dirtyFileCount: 7,
      identityError: null,
      branches: MOCK_BRANCHES,
    }
  }, [workspaceRootPath])
}

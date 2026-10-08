import { useEffect, useMemo, useState } from 'react'
import type { GitWorkspaceSnapshot } from '@rox/shared/git/workspace'

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
  loading: boolean
}

function branchId(name: string): string {
  return name.replace(/\//g, '--')
}

function emptyModel(workspaceRootPath: string | null | undefined): WorkspaceGitModel {
  const label = workspaceRootPath?.split('/').filter(Boolean).pop() ?? 'workspace'
  return {
    repoLabel: label,
    currentBranch: '—',
    dirtyFileCount: 0,
    identityError: null,
    branches: [],
    loading: Boolean(workspaceRootPath),
  }
}

function mapSnapshot(snap: GitWorkspaceSnapshot): WorkspaceGitModel {
  const branches: WorkspaceGitBranch[] = snap.branches.map((row) => ({
    id: branchId(row.name),
    name: row.name,
    ahead: row.ahead,
    behind: row.behind,
    additions: row.additions,
    deletions: row.deletions,
    isCurrent: row.isCurrent,
  }))
  return {
    repoLabel: snap.repoLabel,
    currentBranch: snap.currentBranch ?? '—',
    dirtyFileCount: snap.dirtyFileCount,
    identityError: snap.identityError,
    branches,
    loading: false,
  }
}

const REFRESH_MS = 8000

/** Live workspace git model for the SE profile (IPC-backed). */
export function useWorkspaceGitModel(workspaceRootPath: string | null | undefined): WorkspaceGitModel {
  const [model, setModel] = useState<WorkspaceGitModel>(() => emptyModel(workspaceRootPath))

  useEffect(() => {
    if (!workspaceRootPath) {
      setModel(emptyModel(null))
      return
    }
    let cancelled = false
    const load = async () => {
      const api = window.electronAPI?.getGitWorkspaceSnapshot
      if (!api) {
        if (!cancelled) setModel({ ...emptyModel(workspaceRootPath), loading: false })
        return
      }
      try {
        const snap = await api(workspaceRootPath)
        if (!cancelled) setModel(mapSnapshot(snap))
      } catch {
        if (!cancelled) setModel({ ...emptyModel(workspaceRootPath), loading: false })
      }
    }
    void load()
    const id = window.setInterval(() => void load(), REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [workspaceRootPath])

  return useMemo(() => model, [model])
}

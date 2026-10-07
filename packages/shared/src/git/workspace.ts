import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'
import { execGitReadOnly, readGitBranchName, readGitWorkingTreeStatus } from './exec.ts'

export type GitWorkspaceBranchRow = {
  name: string
  isCurrent: boolean
  ahead: number
  behind: number
  additions: number
  deletions: number
}

export type GitWorkspaceSnapshot = {
  isRepo: boolean
  repoLabel: string
  currentBranch: string | null
  dirtyFileCount: number
  additions: number
  deletions: number
  identityError: string | null
  branches: GitWorkspaceBranchRow[]
}

function sumNumstat(output: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [a, d] = line.split('\t')
    if (a === '-' || d === '-') continue
    additions += Number(a) || 0
    deletions += Number(d) || 0
  }
  return { additions, deletions }
}

function readGitDiffNumstat(cwd: string): { additions: number; deletions: number } {
  try {
    const unstaged = execGitReadOnly(['diff', '--numstat'], cwd)
    const staged = execGitReadOnly(['diff', '--cached', '--numstat'], cwd)
    const u = sumNumstat(unstaged)
    const s = sumNumstat(staged)
    return { additions: u.additions + s.additions, deletions: u.deletions + s.deletions }
  } catch {
    return { additions: 0, deletions: 0 }
  }
}

/** Reads user.name/email using normal git config resolution (not the read-only status env). */
export function readGitIdentity(cwd: string): { name: string; email: string } | null {
  try {
    const email = execFileSync('git', ['config', '--get', 'user.email'], {
      cwd,
      encoding: 'utf8',
      timeout: 3000,
    }).trim()
    const name = execFileSync('git', ['config', '--get', 'user.name'], {
      cwd,
      encoding: 'utf8',
      timeout: 3000,
    }).trim()
    if (!email || !name) return null
    return { name, email }
  } catch {
    return null
  }
}

function readLocalBranchNames(cwd: string): string[] {
  try {
    const raw = execGitReadOnly(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], cwd)
    return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  } catch {
    const current = readGitBranchName(cwd)
    return current ? [current] : []
  }
}

/** Upstream ahead/behind per local branch via `for-each-ref %(upstream:track)`. */
function readBranchUpstreamTracks(cwd: string): Map<string, { ahead: number; behind: number }> {
  const map = new Map<string, { ahead: number; behind: number }>()
  try {
    const raw = execGitReadOnly(
      ['for-each-ref', '--format=%(refname:short)\t%(upstream:track)', 'refs/heads'],
      cwd,
    )
    for (const line of raw.split(/\r?\n/)) {
      const tab = line.indexOf('\t')
      if (tab < 0) continue
      const name = line.slice(0, tab).trim()
      const track = line.slice(tab + 1).trim()
      if (!name) continue
      let ahead = 0
      let behind = 0
      const aheadMatch = track.match(/ahead (\d+)/)
      const behindMatch = track.match(/behind (\d+)/)
      if (aheadMatch) ahead = Number(aheadMatch[1]) || 0
      if (behindMatch) behind = Number(behindMatch[1]) || 0
      map.set(name, { ahead, behind })
    }
  } catch {
    /* empty */
  }
  return map
}

const EMPTY_SNAPSHOT: GitWorkspaceSnapshot = {
  isRepo: false,
  repoLabel: 'workspace',
  currentBranch: null,
  dirtyFileCount: 0,
  additions: 0,
  deletions: 0,
  identityError: null,
  branches: [],
}

export function readGitWorkspaceSnapshot(dirPath: string): GitWorkspaceSnapshot {
  if (!dirPath) return { ...EMPTY_SNAPSHOT }
  const repoLabel = basename(dirPath) || 'workspace'
  const status = readGitWorkingTreeStatus(dirPath)
  if (!status.isRepo) {
    return {
      isRepo: false,
      repoLabel,
      currentBranch: null,
      dirtyFileCount: 0,
      additions: 0,
      deletions: 0,
      identityError: null,
      branches: [],
    }
  }
  const current = status.branch
  const diff = readGitDiffNumstat(dirPath)
  const identity = readGitIdentity(dirPath)
  const names = readLocalBranchNames(dirPath)
  const upstreamTracks = readBranchUpstreamTracks(dirPath)
  const branches: GitWorkspaceBranchRow[] = names.map((name) => {
    const isCurrent = name === current
    const track = upstreamTracks.get(name)
    const ahead = track?.ahead ?? (isCurrent ? status.ahead : 0)
    const behind = track?.behind ?? (isCurrent ? status.behind : 0)
    return {
      name,
      isCurrent,
      ahead,
      behind,
      additions: isCurrent ? diff.additions : 0,
      deletions: isCurrent ? diff.deletions : 0,
    }
  })
  return {
    isRepo: true,
    repoLabel,
    currentBranch: current,
    dirtyFileCount: status.entries.length,
    additions: diff.additions,
    deletions: diff.deletions,
    identityError: identity ? null : 'missing',
    branches,
  }
}

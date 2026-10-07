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
  const branches: GitWorkspaceBranchRow[] = names.map((name) => {
    const isCurrent = name === current
    return {
      name,
      isCurrent,
      ahead: isCurrent ? status.ahead : 0,
      behind: isCurrent ? status.behind : 0,
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

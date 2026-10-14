import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'
import {
  execGitReadOnly,
  gitReadOnlyRunner,
  readGitBranchName,
  readGitWorkingTreeStatus,
  type GitReadOnlyRunner,
} from './exec.ts'
import type { GitWorkingTreeStatus } from './status.ts'

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

type DiffTotals = { additions: number; deletions: number }
type UpstreamTracks = Map<string, { ahead: number; behind: number }>
type GitIdentity = { name: string; email: string }

const SNAPSHOT_GIT_CONCURRENCY = 4
const DIFF_UNSTAGED_COMMAND = ['diff', '--numstat']
const DIFF_STAGED_COMMAND = ['diff', '--cached', '--numstat']
const LOCAL_BRANCHES_COMMAND = ['for-each-ref', '--format=%(refname:short)', 'refs/heads']
const UPSTREAM_TRACKS_COMMAND = ['for-each-ref', '--format=%(refname:short)\t%(upstream:track)', 'refs/heads']
const IDENTITY_TIMEOUT_MS = 3000

function sumNumstat(output: string): DiffTotals {
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

function combineNumstat(unstaged: string, staged: string): DiffTotals {
  const u = sumNumstat(unstaged)
  const s = sumNumstat(staged)
  return { additions: u.additions + s.additions, deletions: u.deletions + s.deletions }
}

function readGitDiffNumstat(cwd: string): DiffTotals {
  try {
    const unstaged = execGitReadOnly(DIFF_UNSTAGED_COMMAND, cwd)
    const staged = execGitReadOnly(DIFF_STAGED_COMMAND, cwd)
    return combineNumstat(unstaged, staged)
  } catch {
    return { additions: 0, deletions: 0 }
  }
}

function toIdentity(email: string, name: string): GitIdentity | null {
  if (!email || !name) return null
  return { name, email }
}

/** Reads user.name/email using normal git config resolution (not the read-only status env). */
export function readGitIdentity(cwd: string): GitIdentity | null {
  try {
    const email = execFileSync('git', ['config', '--get', 'user.email'], {
      cwd,
      encoding: 'utf8',
      timeout: IDENTITY_TIMEOUT_MS,
    }).trim()
    const name = execFileSync('git', ['config', '--get', 'user.name'], {
      cwd,
      encoding: 'utf8',
      timeout: IDENTITY_TIMEOUT_MS,
    }).trim()
    return toIdentity(email, name)
  } catch {
    return null
  }
}

function parseLocalBranchNames(raw: string): string[] {
  return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
}

function readLocalBranchNames(cwd: string): string[] {
  try {
    return parseLocalBranchNames(execGitReadOnly(LOCAL_BRANCHES_COMMAND, cwd))
  } catch {
    const current = readGitBranchName(cwd)
    return current ? [current] : []
  }
}

function parseBranchUpstreamTracks(raw: string): UpstreamTracks {
  const map: UpstreamTracks = new Map()
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
  return map
}

/** Upstream ahead/behind per local branch via `for-each-ref %(upstream:track)`. */
function readBranchUpstreamTracks(cwd: string): UpstreamTracks {
  try {
    return parseBranchUpstreamTracks(execGitReadOnly(UPSTREAM_TRACKS_COMMAND, cwd))
  } catch {
    return new Map()
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

function notRepoSnapshot(repoLabel: string): GitWorkspaceSnapshot {
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

function buildRepoSnapshot(
  repoLabel: string,
  status: GitWorkingTreeStatus,
  diff: DiffTotals,
  identity: GitIdentity | null,
  names: string[],
  upstreamTracks: UpstreamTracks,
): GitWorkspaceSnapshot {
  const current = status.branch
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

export function readGitWorkspaceSnapshot(dirPath: string): GitWorkspaceSnapshot {
  if (!dirPath) return { ...EMPTY_SNAPSHOT }
  const repoLabel = basename(dirPath) || 'workspace'
  const status = readGitWorkingTreeStatus(dirPath)
  if (!status.isRepo) return notRepoSnapshot(repoLabel)
  const diff = readGitDiffNumstat(dirPath)
  const identity = readGitIdentity(dirPath)
  const names = readLocalBranchNames(dirPath)
  const upstreamTracks = readBranchUpstreamTracks(dirPath)
  return buildRepoSnapshot(repoLabel, status, diff, identity, names, upstreamTracks)
}

type Limit = <T>(task: () => Promise<T>) => Promise<T>

function createLimit(concurrency: number): Limit {
  let active = 0
  const queue: Array<() => void> = []
  return async (task) => {
    if (active < concurrency) active++
    else await new Promise<void>((resolve) => queue.push(resolve))
    try {
      return await task()
    } finally {
      const next = queue.shift()
      if (next) next()
      else active--
    }
  }
}

export async function readGitIdentityAsync(
  cwd: string,
  runner: GitReadOnlyRunner = gitReadOnlyRunner,
  limit: Limit = (task) => task(),
): Promise<GitIdentity | null> {
  const readConfig = (key: string) =>
    limit(() =>
      runner.execFile('git', ['config', '--get', key], {
        cwd,
        encoding: 'utf-8',
        timeout: IDENTITY_TIMEOUT_MS,
        env: process.env,
      }),
    )
  try {
    const [email, name] = await Promise.all([readConfig('user.email'), readConfig('user.name')])
    return toIdentity(email.stdout.trim(), name.stdout.trim())
  } catch {
    return null
  }
}

export async function readGitWorkspaceSnapshotAsync(
  dirPath: string,
  runner: GitReadOnlyRunner = gitReadOnlyRunner,
): Promise<GitWorkspaceSnapshot> {
  if (!dirPath) return { ...EMPTY_SNAPSHOT }
  const repoLabel = basename(dirPath) || 'workspace'
  const status = await runner.readGitWorkingTreeStatusAsync(dirPath)
  if (!status.isRepo) return notRepoSnapshot(repoLabel)
  const limit = createLimit(SNAPSHOT_GIT_CONCURRENCY)
  const git = (command: string[]) => limit(() => runner.execGitReadOnlyAsync(command, dirPath))
  const [diff, identity, names, upstreamTracks] = await Promise.all([
    Promise.all([git(DIFF_UNSTAGED_COMMAND), git(DIFF_STAGED_COMMAND)]).then(
      ([unstaged, staged]) => combineNumstat(unstaged, staged),
      () => ({ additions: 0, deletions: 0 }),
    ),
    readGitIdentityAsync(dirPath, runner, limit),
    git(LOCAL_BRANCHES_COMMAND).then(parseLocalBranchNames, async () => {
      const current = await runner.readGitBranchNameAsync(dirPath)
      return current ? [current] : []
    }),
    git(UPSTREAM_TRACKS_COMMAND).then(parseBranchUpstreamTracks, (): UpstreamTracks => new Map()),
  ])
  return buildRepoSnapshot(repoLabel, status, diff, identity, names, upstreamTracks)
}

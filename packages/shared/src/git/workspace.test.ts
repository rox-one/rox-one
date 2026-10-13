import { afterEach, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createGitReadOnlyRunner, type GitExecFileAsync } from './exec.ts'
import { readGitWorkspaceSnapshot, readGitWorkspaceSnapshotAsync } from './workspace.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'git-ws-'))
  dirs.push(dir)
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
  const git = (args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe', env })
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'dev@example.test'])
  git(['config', 'user.name', 'dev'])
  git(['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(dir, 'README.md'), 'ok\n')
  git(['add', 'README.md'])
  git(['commit', '-m', 'init'])
  return dir
}

describe('readGitWorkspaceSnapshot', () => {
  it('returns branch list and dirty count for a repo', () => {
    const dir = gitRepo()
    writeFileSync(join(dir, 'dirty.txt'), 'x\n')
    const snap = readGitWorkspaceSnapshot(dir)
    expect(snap.isRepo).toBe(true)
    expect(snap.currentBranch).toBe('main')
    expect(snap.dirtyFileCount).toBe(1)
    expect(snap.identityError).toBeNull()
    expect(snap.branches.some((b) => b.isCurrent && b.name === 'main')).toBe(true)
  })

  it('reports upstream track for each local branch', () => {
    const dir = gitRepo()
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
    const git = (args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe', env })
    git(['branch', 'feature'])
    git(['branch', '-u', 'main', 'feature'])
    const snap = readGitWorkspaceSnapshot(dir)
    const feature = snap.branches.find((b) => b.name === 'feature')
    expect(feature).toBeDefined()
    expect(feature!.ahead).toBe(0)
    expect(feature!.behind).toBe(0)
  })

})

describe('readGitWorkspaceSnapshotAsync', () => {
  it('returns the same snapshot as the sync reader for a dirty repo with two branches', async () => {
    const dir = gitRepo()
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
    execFileSync('git', ['branch', 'feature'], { cwd: dir, stdio: 'pipe', env })
    writeFileSync(join(dir, 'README.md'), 'one\ntwo\n')
    const expected = {
      isRepo: true,
      repoLabel: basename(dir),
      currentBranch: 'main',
      dirtyFileCount: 1,
      additions: 2,
      deletions: 1,
      identityError: null,
      branches: [
        { name: 'feature', isCurrent: false, ahead: 0, behind: 0, additions: 0, deletions: 0 },
        { name: 'main', isCurrent: true, ahead: 0, behind: 0, additions: 2, deletions: 1 },
      ],
    }

    expect(await readGitWorkspaceSnapshotAsync(dir, createGitReadOnlyRunner())).toEqual(expected)
    expect(readGitWorkspaceSnapshot(dir)).toEqual(expected)
  })

  it('returns the empty snapshot without running git for an empty path', async () => {
    const { calls, execFile } = countingExec()
    const snap = await readGitWorkspaceSnapshotAsync('', createGitReadOnlyRunner({ execFile }))
    expect(snap).toEqual({
      isRepo: false,
      repoLabel: 'workspace',
      currentBranch: null,
      dirtyFileCount: 0,
      additions: 0,
      deletions: 0,
      identityError: null,
      branches: [],
    })
    expect(calls).toHaveLength(0)
  })

  it('stops after the status read for a non-repo directory', async () => {
    const { calls, execFile } = countingExec()
    const snap = await readGitWorkspaceSnapshotAsync('/not/a/repo', createGitReadOnlyRunner({ execFile }))
    expect(snap.isRepo).toBe(false)
    expect(snap.repoLabel).toBe('repo')
    expect(calls).toHaveLength(1)
  })

  it('runs the six post-status git children at most 4 at a time', async () => {
    let active = 0
    let peak = 0
    let spawned = 0
    const execFile: GitExecFileAsync = async (_file, args) => {
      spawned++
      if (args.includes('status')) return { stdout: '## main\n' }
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 0))
      active--
      if (args.includes('config')) return { stdout: 'dev\n' }
      return { stdout: args.includes('for-each-ref') ? 'main\n' : '' }
    }
    const snap = await readGitWorkspaceSnapshotAsync('/work/app', createGitReadOnlyRunner({ execFile }))
    expect(snap.identityError).toBeNull()
    expect(snap.branches.map((b) => b.name)).toEqual(['main'])
    expect(spawned).toBe(7)
    expect(peak).toBe(4)
  })
})

function countingExec() {
  const calls: string[][] = []
  const execFile: GitExecFileAsync = async (_file, args) => {
    calls.push(args)
    throw new Error('fatal: not a git repository')
  }
  return { calls, execFile }
}

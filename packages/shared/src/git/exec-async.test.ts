import { afterEach, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createGitReadOnlyRunner,
  execGitReadOnly,
  readGitBranchName,
  readGitWorkingTreeStatus,
  type GitExecFileAsync,
} from './exec.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'git-exec-async-'))
  dirs.push(dir)
  return dir
}

function gitRepo(): string {
  const dir = tempDir()
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
  const git = (args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe', env })
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'dev@example.test'])
  git(['config', 'user.name', 'dev'])
  git(['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(dir, 'README.md'), 'ok\n')
  git(['add', 'README.md'])
  git(['commit', '-m', 'init'])
  writeFileSync(join(dir, 'README.md'), 'changed\n')
  return dir
}

type ExecCall = { args: string[]; cwd: string; timeout: number }

function countingExec(result: (args: string[]) => Promise<{ stdout: string }>) {
  const calls: ExecCall[] = []
  const execFile: GitExecFileAsync = (_file, args, options) => {
    calls.push({ args, cwd: options.cwd, timeout: options.timeout })
    return result(args)
  }
  return { calls, execFile }
}

const EMPTY_STATUS = { isRepo: false, branch: null, ahead: 0, behind: 0, entries: [] }

describe('async read-only git on a real repo', () => {
  it('returns the same status, branch and raw output as the sync helpers', async () => {
    const dir = gitRepo()
    const runner = createGitReadOnlyRunner()
    const expectedStatus = {
      isRepo: true,
      branch: 'main',
      ahead: 0,
      behind: 0,
      entries: [{ index: ' ', worktree: 'M', path: 'README.md' }],
    }

    expect(await runner.readGitWorkingTreeStatusAsync(dir)).toEqual(expectedStatus)
    expect(readGitWorkingTreeStatus(dir)).toEqual(expectedStatus)
    expect(await runner.readGitBranchNameAsync(dir)).toBe('main')
    expect(readGitBranchName(dir)).toBe('main')
    expect(await runner.execGitReadOnlyAsync(['diff', '--numstat'], dir)).toBe('1\t1\tREADME.md\n')
    expect(execGitReadOnly(['diff', '--numstat'], dir)).toBe('1\t1\tREADME.md\n')
  })

  it('maps a non-repo directory to the same empty results as the sync helpers', async () => {
    const dir = tempDir()
    const runner = createGitReadOnlyRunner()

    expect(await runner.readGitWorkingTreeStatusAsync(dir)).toEqual(EMPTY_STATUS)
    expect(readGitWorkingTreeStatus(dir)).toEqual(EMPTY_STATUS)
    expect(await runner.readGitBranchNameAsync(dir)).toBeNull()
    expect(readGitBranchName(dir)).toBeNull()
    expect(() => execGitReadOnly(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).toThrow()
    await expect(runner.execGitReadOnlyAsync(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).rejects.toThrow()
  })
})

describe('single-flight', () => {
  it('shares one child between concurrent identical calls', async () => {
    const { calls, execFile } = countingExec(async () => ({ stdout: 'main\n' }))
    const runner = createGitReadOnlyRunner({ execFile })

    const [a, b] = await Promise.all([
      runner.execGitReadOnlyAsync(['rev-parse', '--abbrev-ref', 'HEAD'], '/repo'),
      runner.execGitReadOnlyAsync(['rev-parse', '--abbrev-ref', 'HEAD'], '/repo'),
    ])

    expect(a).toBe('main\n')
    expect(b).toBe('main\n')
    expect(calls).toHaveLength(1)
  })

  it('spawns separately for another cwd, another command, and after the first call settles', async () => {
    const { calls, execFile } = countingExec(async () => ({ stdout: '' }))
    const runner = createGitReadOnlyRunner({ execFile })

    await Promise.all([
      runner.execGitReadOnlyAsync(['diff', '--numstat'], '/repo'),
      runner.execGitReadOnlyAsync(['diff', '--numstat'], '/other'),
      runner.execGitReadOnlyAsync(['diff', '--cached', '--numstat'], '/repo'),
    ])
    expect(calls).toHaveLength(3)

    await runner.execGitReadOnlyAsync(['diff', '--numstat'], '/repo')
    expect(calls).toHaveLength(4)
  })

  it('shares one child between concurrent status reads', async () => {
    const { calls, execFile } = countingExec(async () => ({ stdout: '## main\n M a.ts\n' }))
    const runner = createGitReadOnlyRunner({ execFile })

    const [a, b] = await Promise.all([
      runner.readGitWorkingTreeStatusAsync('/repo'),
      runner.readGitWorkingTreeStatusAsync('/repo'),
    ])

    const expected = { isRepo: true, branch: 'main', ahead: 0, behind: 0, entries: [{ index: ' ', worktree: 'M', path: 'a.ts' }] }
    expect(a).toEqual(expected)
    expect(b).toEqual(expected)
    expect(calls).toHaveLength(1)
  })
})

describe('result cache', () => {
  it('reuses branch reads for 1000 ms by default, then reads again', async () => {
    let now = 0
    const { calls, execFile } = countingExec(async () => ({ stdout: 'main\n' }))
    const runner = createGitReadOnlyRunner({ execFile, now: () => now })

    expect(await runner.readGitBranchNameAsync('/repo')).toBe('main')
    now = 999
    expect(await runner.readGitBranchNameAsync('/repo')).toBe('main')
    expect(calls).toHaveLength(1)

    now = 1000
    expect(await runner.readGitBranchNameAsync('/repo')).toBe('main')
    expect(calls).toHaveLength(2)
  })

  it('reuses status reads within a custom TTL and returns independent copies', async () => {
    let now = 0
    const { calls, execFile } = countingExec(async () => ({ stdout: '## main\n?? new.txt\n' }))
    const runner = createGitReadOnlyRunner({ execFile, now: () => now, cacheTtlMs: 50 })

    const first = await runner.readGitWorkingTreeStatusAsync('/repo')
    first.entries.push({ index: 'M', worktree: ' ', path: 'mutated.ts' })
    now = 49
    const second = await runner.readGitWorkingTreeStatusAsync('/repo')
    expect(second.entries).toEqual([{ index: '?', worktree: '?', path: 'new.txt' }])
    expect(calls).toHaveLength(1)

    now = 50
    await runner.readGitWorkingTreeStatusAsync('/repo')
    expect(calls).toHaveLength(2)
  })

  it('drops cached reads only for the invalidated cwd', async () => {
    const { calls, execFile } = countingExec(async () => ({ stdout: 'main\n' }))
    const runner = createGitReadOnlyRunner({ execFile, now: () => 0 })

    await runner.readGitBranchNameAsync('/repo')
    await runner.readGitBranchNameAsync('/other')
    runner.invalidateGitReadCache('/repo')
    await runner.readGitBranchNameAsync('/repo')
    await runner.readGitBranchNameAsync('/other')

    expect(calls.map((c) => c.cwd)).toEqual(['/repo', '/other', '/repo'])
  })

  it('does not cache a read that was in flight when the cwd was invalidated', async () => {
    let release: (value: { stdout: string }) => void = () => {}
    const { calls, execFile } = countingExec(() => new Promise((resolve) => (release = resolve)))
    const runner = createGitReadOnlyRunner({ execFile, now: () => 0 })

    const stale = runner.readGitBranchNameAsync('/repo')
    await Promise.resolve()
    runner.invalidateGitReadCache('/repo')
    release({ stdout: 'old\n' })
    expect(await stale).toBe('old')

    const fresh = runner.readGitBranchNameAsync('/repo')
    await Promise.resolve()
    release({ stdout: 'new\n' })
    expect(await fresh).toBe('new')
    expect(calls).toHaveLength(2)
  })
})

describe('timeouts and error mapping', () => {
  it('passes the 5000 ms default timeout and a caller timeout through to the child', async () => {
    const { calls, execFile } = countingExec(async () => ({ stdout: '' }))
    const runner = createGitReadOnlyRunner({ execFile })

    await runner.readGitWorkingTreeStatusAsync('/repo')
    await runner.execGitReadOnlyAsync(['diff', '--numstat'], '/repo', 1234)

    expect(calls.map((c) => c.timeout)).toEqual([5000, 1234])
    expect(calls[0]!.args.slice(-3)).toEqual(['status', '--porcelain=v1', '-b'])
    expect(calls[0]!.args).toContain('alias.status=')
    expect(calls[0]!.args).toContain('core.fsmonitor=')
  })

  it('maps a killed-by-timeout child to the empty status and a null branch', async () => {
    const timedOut = Object.assign(new Error('Command failed: git status'), { killed: true, signal: 'SIGTERM', code: null })
    const { execFile } = countingExec(async () => {
      throw timedOut
    })
    const runner = createGitReadOnlyRunner({ execFile })

    expect(await runner.readGitWorkingTreeStatusAsync('/repo')).toEqual(EMPTY_STATUS)
    expect(await runner.readGitBranchNameAsync('/repo')).toBeNull()
    await expect(runner.execGitReadOnlyAsync(['diff'], '/repo')).rejects.toBe(timedOut)
  })

  it('maps an empty branch output to null like the sync helper', async () => {
    const { execFile } = countingExec(async () => ({ stdout: '\n' }))
    const runner = createGitReadOnlyRunner({ execFile })

    expect(await runner.readGitBranchNameAsync('/repo')).toBeNull()
  })
})

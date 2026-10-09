import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAvailabilityMemo, createGitExec, resetGitIdentityCacheForTests } from '../git-exec'

const dirs: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  dirs.push(dir)
  return dir
}

function rawGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  resetGitIdentityCacheForTests()
})

describe('createGitExec', () => {
  test('reports git availability', async () => {
    expect(await createGitExec().available()).toBe(true)
  })

  test('honours caller GIT_DIR env (argv-only, no repository discovery)', async () => {
    const cwd = tempDir('git-exec-env')
    const gitDir = join(cwd, 'custom-git-dir')
    const git = createGitExec()
    const result = await git.run(['rev-parse', '--git-dir'], { cwd, env: { GIT_DIR: gitDir, GIT_WORK_TREE: cwd } })
    expect(result.ok).toBe(false) // uninitialised, but the env must reach git
    expect(result.stderr).not.toContain('forbidden')
  })

  test('uses the tree identity when one exists, Rox fallback otherwise', async () => {
    const cwd = tempDir('git-exec-identity')
    rawGit(cwd, ['init', '-q', '-b', 'main'])
    rawGit(cwd, ['config', 'user.name', 'Test User'])
    rawGit(cwd, ['config', 'user.email', 'test@example.com'])
    writeFileSync(join(cwd, 'a.txt'), 'a\n')

    const git = createGitExec()
    expect((await git.run(['add', '-A', '--', 'a.txt'], { cwd })).ok).toBe(true)
    expect((await git.run(['commit', '-q', '-m', 'init'], { cwd })).ok).toBe(true)
    expect(rawGit(cwd, ['log', '-1', '--format=%an <%ae>']).trim()).toBe('Test User <test@example.com>')

    const fallbackDir = tempDir('git-exec-fallback')
    rawGit(fallbackDir, ['init', '-q', '-b', 'main'])
    writeFileSync(join(fallbackDir, 'b.txt'), 'b\n')
    const previousGlobal = process.env.GIT_CONFIG_GLOBAL
    const previousSystem = process.env.GIT_CONFIG_NOSYSTEM
    process.env.GIT_CONFIG_GLOBAL = '/dev/null'
    process.env.GIT_CONFIG_NOSYSTEM = '1'
    try {
      const fallbackGit = createGitExec()
      expect((await fallbackGit.run(['add', '-A', '--', 'b.txt'], { cwd: fallbackDir })).ok).toBe(true)
      expect((await fallbackGit.run(['commit', '-q', '-m', 'init'], { cwd: fallbackDir })).ok).toBe(true)
    } finally {
      if (previousGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL
      else process.env.GIT_CONFIG_GLOBAL = previousGlobal
      if (previousSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM
      else process.env.GIT_CONFIG_NOSYSTEM = previousSystem
    }
    expect(rawGit(fallbackDir, ['log', '-1', '--format=%an <%ae>']).trim()).toBe('Rox <rox@localhost>')
    expect(readFileSync(join(fallbackDir, 'b.txt'), 'utf8')).toBe('b\n')
  })

  test('rejects destructive commands without running them', async () => {
    const cwd = tempDir('git-exec-forbidden')
    const git = createGitExec()
    const push = await git.run(['push', 'origin', 'main'], { cwd })
    expect(push.ok).toBe(false)
    expect(push.stderr).toContain('forbidden')
    const reset = await git.run(['reset', '--hard', 'HEAD'], { cwd })
    expect(reset.ok).toBe(false)
    const amend = await git.run(['commit', '--amend', '-m', 'x'], { cwd })
    expect(amend.ok).toBe(false)
  })

  test('caches the availability probe: one `git --version` spawn per TTL', async () => {
    // PATH shim counts only `--version` invocations, so identity reads are ignored.
    const binDir = tempDir('git-exec-path')
    const counterFile = join(binDir, 'version-spawns')
    writeFileSync(
      join(binDir, 'git'),
      '#!/bin/sh\ncase " $* " in *" --version "*) echo x >> "$GIT_EXEC_COUNTER" ;; esac\nexit 0\n',
      { mode: 0o755 },
    )
    const previousPath = process.env.PATH
    const previousCounter = process.env.GIT_EXEC_COUNTER
    process.env.PATH = `${binDir}:${previousPath ?? ''}`
    process.env.GIT_EXEC_COUNTER = counterFile
    try {
      const git = createGitExec({ availableTtlMs: 60_000 })
      const first = await git.available()
      const second = await git.available()
      expect(second).toBe(first)
      expect(first).toBe(true)
      expect(readFileSync(counterFile, 'utf8').trim().split('\n').length).toBe(1)
    } finally {
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
      if (previousCounter === undefined) delete process.env.GIT_EXEC_COUNTER
      else process.env.GIT_EXEC_COUNTER = previousCounter
    }
  })
})

describe('createAvailabilityMemo', () => {
  test('probes once and reuses a false result inside the TTL, re-probing after it', async () => {
    let probes = 0
    let clock = 1_000
    const memo = createAvailabilityMemo(
      async () => {
        probes += 1
        return false
      },
      { ttlMs: 30_000, now: () => clock },
    )
    expect(await memo.available()).toBe(false)
    expect(await memo.available()).toBe(false)
    expect(probes).toBe(1)

    clock += 30_000
    expect(await memo.available()).toBe(false)
    expect(probes).toBe(2)
  })

  test('concurrent calls share one in-flight probe', async () => {
    let probes = 0
    let release: (value: boolean) => void = () => {}
    const memo = createAvailabilityMemo(() => {
      probes += 1
      return new Promise<boolean>((resolve) => {
        release = resolve
      })
    })
    const first = memo.available()
    const second = memo.available()
    release(true)
    expect(await Promise.all([first, second])).toEqual([true, true])
    expect(probes).toBe(1)
  })

  test('a failing probe resolves to false and is cached', async () => {
    let probes = 0
    const memo = createAvailabilityMemo(
      async () => {
        probes += 1
        throw new Error('spawn failed')
      },
      { ttlMs: 30_000 },
    )
    expect(await memo.available()).toBe(false)
    expect(await memo.available()).toBe(false)
    expect(probes).toBe(1)
  })
})
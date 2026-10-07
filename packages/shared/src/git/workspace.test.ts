import { afterEach, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readGitWorkspaceSnapshot } from './workspace.ts'

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

})

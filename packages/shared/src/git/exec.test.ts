import { afterEach, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readGitBranchName, readGitWorkingTreeStatus } from './exec.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'git-exec-'))
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

describe('read-only git exec', () => {
  it('returns porcelain status and branch without honoring a status alias', () => {
    const dir = gitRepo()
    mkdirSync(join(dir, '.git'), { recursive: true })
    writeFileSync(
      join(dir, '.git', 'config'),
      `${readFileSync(join(dir, '.git', 'config'), 'utf8')}\n[alias]\n\tstatus = !touch pwned\n`,
    )
    const status = readGitWorkingTreeStatus(dir)
    expect(status.isRepo).toBe(true)
    expect(status.branch).toBe('main')
    expect(readGitBranchName(dir)).toBe('main')
    expect(existsSync(join(dir, 'pwned'))).toBe(false)
  })

  it('uses execFileSync argv and disables alias/fsmonitor in the helper source', () => {
    const src = readFileSync(join(import.meta.dir, 'exec.ts'), 'utf8')
    expect(src).toContain("execFileSync('git'")
    expect(src).toContain('GIT_CONFIG_NOSYSTEM')
    expect(src).toContain('alias.status=')
    expect(src).toContain('core.fsmonitor=')
    expect(src).not.toContain('execSync(')
  })
})



/** W1-10 self-test: shrink-only allowlists compared against the git merge-base (temp repo, no network). */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBaseAllowlist, resolveAllowlist } from '../src/gates/allowlist.ts'

const REL = join('packages', 'test-harness', 'allowlists', 'demo.json')

function git(cwd: string, ...args: string[]): string {
  const proc = Bun.spawnSync(['git', '-c', 'user.name=w1-10', '-c', 'user.email=w1-10@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: cwd, GIT_CONFIG_NOSYSTEM: '1' },
  })
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${proc.stderr.toString()}`)
  return proc.stdout.toString().trim()
}

function write(root: string, entries: string[]): void {
  mkdirSync(join(root, REL, '..'), { recursive: true })
  writeFileSync(join(root, REL), JSON.stringify({ $comment: 'demo', items: entries }))
}

describe('shrink-only allowlist vs the merge-base', () => {
  const root = mkdtempSync(join(tmpdir(), 'w1-10-allow-git-'))
  git(root, 'init', '-q', '-b', 'main')
  writeFileSync(join(root, 'README'), 'x')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'before the list')
  const beforeList = git(root, 'rev-parse', 'HEAD')
  write(root, ['a', 'b'])
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'introduce list')
  const withList = git(root, 'rev-parse', 'HEAD')

  test('removing entries is fine; adding one fails', () => {
    write(root, ['a'])
    expect(resolveAllowlist(root, REL, 'items', {}, { ROX_PROVENANCE_BASE: withList }).problems).toEqual([])
    write(root, ['a', 'b', 'c'])
    const grown = resolveAllowlist(root, REL, 'items', {}, { ROX_PROVENANCE_BASE: withList })
    expect(grown.problems).toEqual([`packages/test-harness/allowlists/demo.json#items: 'c' was added; the allowlist may only shrink (fix the exception instead)`])
  })
  test('the change that introduces the list (absent at the merge-base) is accepted', () => {
    expect(readBaseAllowlist(root, REL, 'items', { ROX_PROVENANCE_BASE: beforeList })).toEqual({ ok: true, entries: null })
    write(root, ['a', 'b', 'c'])
    expect(resolveAllowlist(root, REL, 'items', {}, { ROX_PROVENANCE_BASE: beforeList }).problems).toEqual([])
  })
  test('an unresolvable base fails closed', () => {
    const res = resolveAllowlist(root, REL, 'items', {}, { ROX_PROVENANCE_BASE: 'origin/w1-10-no-such-base' })
    expect(res.problems.join(' ')).toContain('cannot verify shrink-only')
  })
})

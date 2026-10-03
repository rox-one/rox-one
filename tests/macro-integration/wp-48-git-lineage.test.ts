import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { collectGitLineage } from '../../scripts/compliance/collect-git-lineage'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rox-wp48-lineage-test-')))
  roots.push(root)
  function run(args: string[]) {
    const result = Bun.spawnSync(['git', ...args], { cwd: root, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, stdout: 'pipe', stderr: 'pipe' })
    if (result.exitCode !== 0) throw new Error('FIXTURE_GIT_FAILED')
  }
  run(['init', '-q'])
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'base.ts'), 'export const value = 1\n')
  run(['add', 'src/base.ts'])
  run(['-c', 'user.name=Synthetic Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Synthetic lineage fixture; no review approval'])
  return { root, run }
}
test('binds unmodified tracked source to actual Git base blob and history', () => {
  const { root } = fixture()
  const result = collectGitLineage({ root, paths: ['src/base.ts'] })
  expect(result.files[0]?.matchesHead).toBe(true)
  expect(result.files[0]?.history).toHaveLength(1)
  expect(result.dirtySourceCount).toBe(0)
  expect(result.legalApproval).toBe(false)
})
test('retains both base and changed current hashes for dirty source', () => {
  const { root } = fixture()
  writeFileSync(join(root, 'src', 'base.ts'), 'export const value = 2\n')
  const result = collectGitLineage({ root, paths: ['src/base.ts'] })
  expect(result.files[0]?.matchesHead).toBe(false)
  expect(result.files[0]?.currentSha256).not.toBe(result.files[0]?.headSha256)
  expect(result.files[0]?.diffBytes).toBeGreaterThan(0)
  expect(result.files[0]?.status).toContain(' M')
})
test('marks newly produced source without claiming committed origin', () => {
  const { root } = fixture()
  writeFileSync(join(root, 'src', 'new.ts'), 'export const newValue = 1\n')
  const result = collectGitLineage({ root, paths: ['src/new.ts'] })
  expect(result.files[0]?.headBlob).toBeNull()
  expect(result.files[0]?.history).toEqual([])
  expect(result.files[0]?.originState).toBe('NEW_SOURCE_WITHOUT_GIT_HISTORY')
})
test('rejects traversal and duplicate scoped inputs', () => {
  const { root } = fixture()
  expect(() => collectGitLineage({ root, paths: ['../outside.ts'] })).toThrow('INVALID_SOURCE_PATH')
  expect(() => collectGitLineage({ root, paths: ['src/base.ts', 'src/base.ts'] })).toThrow('INVALID_SOURCE_SET')
})
test('rejects owned fixture input symlink without writes through the link', () => {
  const { root } = fixture()
  symlinkSync(join(root, 'src', 'base.ts'), join(root, 'src', 'link.ts'))
  expect(() => collectGitLineage({ root, paths: ['src/link.ts'] })).toThrow('SOURCE_SYMLINK_UNVERIFIED')
})

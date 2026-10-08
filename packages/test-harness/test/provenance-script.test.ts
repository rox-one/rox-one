/** W1-10 self-test: scripts/check-provenance.ts fails closed when git cannot answer. */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'check-provenance.ts')

function run(env: Record<string, string>) {
  const proc = Bun.spawnSync([process.execPath, SCRIPT], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return { code: proc.exitCode, out: `${proc.stdout.toString()}${proc.stderr.toString()}` }
}

describe('check-provenance script', () => {
  test('an unresolvable base fails instead of passing vacuously', () => {
    const res = run({ ROX_PROVENANCE_BASE: 'origin/w1-10-no-such-branch-for-provenance' })
    expect(res.code).toBe(1)
    expect(res.out).toContain('provenance check failed')
    expect(res.out).not.toContain('passed')
  })
  test('HEAD as its own base scans only untracked files and passes', () => {
    const res = run({ ROX_PROVENANCE_BASE: 'HEAD' })
    expect(res.code).toBe(0)
    expect(res.out).toContain('vs HEAD')
  })
})

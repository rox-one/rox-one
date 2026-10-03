import { expect, test } from 'bun:test'
import { join } from 'node:path'

test('actual task cache/native receipt observers run with an isolated renderer lifecycle', async () => {
  const child = Bun.spawn([process.execPath, 'test', join(import.meta.dir, 'personal-task-commit-observer.isolated.ts')], { stdout: 'pipe', stderr: 'pipe' })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  if (code !== 0) throw new Error(stdout + stderr)
  expect(stderr).toContain('1 pass'); expect(stderr).toContain('0 fail')
}, 20_000)

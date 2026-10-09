import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

// The behavioral cases mount the production dictation hosts under happy-dom,
// and the window must exist before React DOM, Radix and the components load.
// A fresh process keeps that order stable no matter which sibling suites in
// the same `bun test` run imported the voice modules first — same pattern as
// profile-strip-accessibility and overlay-owner.
test('dictation hosts arbitrate and release in an isolated renderer process', () => {
  const appRoot = join(import.meta.dir, '../../../..')
  const result = spawnSync(process.execPath, [
    'test', './src/renderer/voice/__tests__/dictation-hosts.isolated.tsx',
  ], { cwd: appRoot, encoding: 'utf8', timeout: 60_000 })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  expect(result.error, output).toBeUndefined()
  expect(result.status, output).toBe(0)
  expect(output).toContain('7 pass')
  expect(output).toContain('0 fail')
}, 70_000)
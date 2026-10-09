import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dir, 'check-yaml-duplicates.ts')

const runGuard = (args: string[]) => spawnSync('bun', [SCRIPT, ...args], { encoding: 'utf8' })

// Real child-process checks; every fixture lives in an isolated temp directory.
test('reports a duplicated mapping key and exits non-zero', () => {
  const directory = mkdtempSync(join(tmpdir(), 'check-yaml-duplicates-'))
  try {
    const file = join(directory, 'duplicate.yml')
    writeFileSync(file, "refs: ['a', 'b']\nrefs: ['a', 'b']\n")
    const result = runGuard([file])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("duplicated key 'refs'")
    expect(result.stderr).toContain(file)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('accepts a file whose keys are unique and exits zero', () => {
  const directory = mkdtempSync(join(tmpdir(), 'check-yaml-duplicates-'))
  try {
    const file = join(directory, 'unique.yml')
    writeFileSync(file, 'refs: [a, b]\nnote: |\n  ok\n')
    const result = runGuard([file])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('no duplicate mapping keys in 1 files')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('the repository hand-maintained YAML set is free of duplicate keys', () => {
  const result = runGuard([])
  expect(result.stdout).toContain('no duplicate mapping keys')
  expect(result.status).toBe(0)
})
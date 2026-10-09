import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const REPO_ROOT = join(import.meta.dir, '../../../../../..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') continue
      out.push(...sourceFiles(full))
      continue
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue
    out.push(full)
  }
  return out
}

const DEFINITION = /export\s+(?:async\s+)?function\s+registerOnboardingHandlers\s*\(/

test('registerOnboardingHandlers is defined exactly once, in server-core', () => {
  const definers = [...sourceFiles(join(REPO_ROOT, 'apps')), ...sourceFiles(join(REPO_ROOT, 'packages'))]
    .filter(file => DEFINITION.test(readFileSync(file, 'utf8')))
    .map(file => relative(REPO_ROOT, file).split('\\').join('/'))
    .sort()
  expect(definers).toEqual(['packages/server-core/src/handlers/rpc/onboarding.ts'])
})

test('the server-core onboarding handler is wired into the production registration graph', () => {
  const index = readFileSync(join(REPO_ROOT, 'packages/server-core/src/handlers/rpc/index.ts'), 'utf8')
  expect(index).toContain("import { registerOnboardingHandlers } from './onboarding'")
  expect(index).toMatch(/registerOnboardingHandlers\(server,\s*deps\)/)
})
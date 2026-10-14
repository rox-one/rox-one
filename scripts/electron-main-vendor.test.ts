import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MAIN_VENDOR_BUNDLES, mainVendorAliasFlags } from './electron-main-cjs'

const repo = resolve(import.meta.dir, '..')

test('every vendor package is aliased to ./vendor/<file> and kept external, nothing broader', () => {
  const flags = mainVendorAliasFlags()
  for (const { pkg, file } of MAIN_VENDOR_BUNDLES) {
    expect(flags).toContain(`--alias:${pkg}=./vendor/${file}`)
    expect(flags).toContain(`--external:./vendor/${file}`)
  }
  expect(flags.some((f) => f.includes('*'))).toBe(false)
  expect(flags).toHaveLength(MAIN_VENDOR_BUNDLES.length * 2)
})

test('vendor files are .cjs and unique', () => {
  const files = MAIN_VENDOR_BUNDLES.map((b) => b.file)
  expect(new Set(files).size).toBe(files.length)
  for (const f of files) expect(f.endsWith('.cjs')).toBe(true)
})

test('call sites import vendor packages lazily, never statically', () => {
  const files = readFileSync(resolve(repo, 'packages/server-core/src/handlers/rpc/files.ts'), 'utf8')
  expect(files).not.toMatch(/^import [^\n]*from 'markitdown-js'/m)
  expect(files).toContain("await import('markitdown-js')")
  const registry = readFileSync(resolve(repo, 'packages/messaging-gateway/src/registry.ts'), 'utf8')
  expect(registry).not.toMatch(/^import \{[^}]*LarkAdapter[^}]*\} from '\.\/adapters\/lark\/index'/m)
  expect(registry).toContain("await import('./adapters/lark/index')")
})

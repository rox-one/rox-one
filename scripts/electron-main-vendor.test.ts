import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MAIN_VENDOR_BUNDLES, mainVendorAliasFlags, vendorExportProbe } from './electron-main-cjs'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

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
  const mermaid = readFileSync(resolve(repo, 'packages/session-tools-core/src/handlers/mermaid-validate.ts'), 'utf8')
  expect(mermaid).not.toMatch(/^import [^\n]*from 'beautiful-mermaid'/m)
  expect(mermaid).toContain("await import('beautiful-mermaid')")
})

test('export probe passes for esbuild-style CJS and fails on a missing name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vendor-probe-'))
  const file = join(dir, 'v.cjs')
  writeFileSync(file, 'var e={};Object.defineProperty(exports,"A",{get:()=>1});0&&(module.exports={A});')
  const url = pathToFileURL(file).href
  expect(execFileSync('node', ['-e', vendorExportProbe(url, ['A'])]).toString().trim()).toBe('[]')
  expect(() => execFileSync('node', ['-e', vendorExportProbe(url, ['A', 'B'])], { stdio: 'pipe' })).toThrow()
  expect(execFileSync('node', ['-e', vendorExportProbe(url, ['A'], 'require')]).toString().trim()).toBe('[]')
})

test('the Lark SDK is reached via require (static import inside the lazily imported adapter)', () => {
  const lark = MAIN_VENDOR_BUNDLES.find((b) => b.pkg === '@larksuiteoapi/node-sdk')
  expect(lark?.load).toBe('require')
  const adapter = readFileSync(resolve(repo, 'packages/messaging-gateway/src/adapters/lark/index.ts'), 'utf8')
  expect(adapter).toMatch(/^import \* as lark from '@larksuiteoapi\/node-sdk'/m)
})

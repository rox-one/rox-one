import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-172..174 native RPC list/read/act gates', () => {
  test('pages.ts gates list/read/write/destroy; lease/execute are not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/pages.ts')
    expect(src).toContain('rpcPagesListResult')
    expect(src).toContain('rpcPagesReadResult')
    expect(src).toContain('rpcPagesActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupCall')
  })

  test('plugin-bridge.ts gates list/read/write/destroy; install is write not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/plugin-bridge.ts')
    expect(src).toContain('rpcPluginBridgeListResult')
    expect(src).toContain('rpcPluginBridgeReadResult')
    expect(src).toContain('rpcPluginBridgeActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupCall')
  })

  test('privacy.ts gates list/read/write/destroy; export/deletion request are write not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/privacy.ts')
    expect(src).toContain('rpcPrivacyListResult')
    expect(src).toContain('rpcPrivacyReadResult')
    expect(src).toContain('rpcPrivacyActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupEmailThread')
    expect(src).not.toContain('GraphqlSoupCrmCompany')
  })
})

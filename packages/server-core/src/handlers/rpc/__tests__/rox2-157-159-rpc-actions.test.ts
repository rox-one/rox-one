import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-157..159 native RPC list/read/act gates', () => {
  test('labels.ts gates list/read/write/destroy; create is not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/labels.ts')
    expect(src).toContain('rpcLabelsListResult')
    expect(src).toContain('rpcLabelsReadResult')
    expect(src).toContain('rpcLabelsActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })

  test('llm-connections.ts gates list/read/write/destroy; test is not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/llm-connections.ts')
    expect(src).toContain('rpcLlmConnectionsListResult')
    expect(src).toContain('rpcLlmConnectionsReadResult')
    expect(src).toContain('rpcLlmConnectionsActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })

  test('marketplace.ts gates list/read/write/destroy; install is not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/marketplace.ts')
    expect(src).toContain('rpcMarketplaceListResult')
    expect(src).toContain('rpcMarketplaceReadResult')
    expect(src).toContain('rpcMarketplaceActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })
})

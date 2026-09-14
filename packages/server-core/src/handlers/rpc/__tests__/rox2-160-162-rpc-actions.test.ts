import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-160..162 native RPC list/read/act gates', () => {
  test('memory-insights.ts gates list/read/write; onboarded is not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/memory-insights.ts')
    expect(src).toContain('rpcMemoryInsightsListResult')
    expect(src).toContain('rpcMemoryInsightsReadResult')
    expect(src).toContain('rpcMemoryInsightsActResult')
    expect(src).toContain("action: 'write'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })

  test('memory-io.ts gates list/read/write; import is not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/memory-io.ts')
    expect(src).toContain('rpcMemoryIoListResult')
    expect(src).toContain('rpcMemoryIoReadResult')
    expect(src).toContain('rpcMemoryIoActResult')
    expect(src).toContain("action: 'write'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })

  test('memory-proposals.ts gates list/read/write/destroy; extract is not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/memory-proposals.ts')
    expect(src).toContain('rpcMemoryProposalsListResult')
    expect(src).toContain('rpcMemoryProposalsReadResult')
    expect(src).toContain('rpcMemoryProposalsActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })
})

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-163..165 native RPC list/read/act gates', () => {
  test('memory.ts gates list/read/write/destroy; add is not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/memory.ts')
    expect(src).toContain('rpcMemoryListResult')
    expect(src).toContain('rpcMemoryReadResult')
    expect(src).toContain('rpcMemoryActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })

  test('messaging.ts gates native config only; test is not spend and not live Channels/Mail', () => {
    const src = source('packages/server-core/src/handlers/rpc/messaging.ts')
    expect(src).toContain('rpcMessagingListResult')
    expect(src).toContain('rpcMessagingReadResult')
    expect(src).toContain('rpcMessagingActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupChannel')
    expect(src).not.toContain('GraphqlSoupEmailThread')
  })

  test('mindmap.ts gates list/read/write/destroy; enrich DTO ok is not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/mindmap.ts')
    expect(src).toContain('rpcMindmapListResult')
    expect(src).toContain('rpcMindmapReadResult')
    expect(src).toContain('rpcMindmapActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })
})

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-145..147 native RPC list/read/act gates', () => {
  test('collection.ts gates list/read/write and does not embed Conation', () => {
    const src = source('packages/server-core/src/handlers/rpc/collection.ts')
    expect(src).toContain('rpcCollectionListResult')
    expect(src).toContain('rpcCollectionReadResult')
    expect(src).toContain('rpcCollectionActResult')
    expect(src).toContain("action: 'write'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })

  test('command-gateway.ts gates list/read/write/destroy; DTO ok is not a live claim', () => {
    const src = source('packages/server-core/src/handlers/rpc/command-gateway.ts')
    expect(src).toContain('rpcCommandGatewayListResult')
    expect(src).toContain('rpcCommandGatewayReadResult')
    expect(src).toContain('rpcCommandGatewayActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })

  test('context-docs.ts gates list/read/write/destroy and does not embed Conation', () => {
    const src = source('packages/server-core/src/handlers/rpc/context-docs.ts')
    expect(src).toContain('rpcContextDocsListResult')
    expect(src).toContain('rpcContextDocsReadResult')
    expect(src).toContain('rpcContextDocsActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })
})

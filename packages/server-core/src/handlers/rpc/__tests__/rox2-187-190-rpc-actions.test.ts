import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-187..190 native RPC list/read/act gates', () => {
  test('toolchain.ts gates list/read/write; update is write not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/toolchain.ts')
    expect(src).toContain('rpcToolchainListResult')
    expect(src).toContain('rpcToolchainReadResult')
    expect(src).toContain('rpcToolchainActResult')
    expect(src).toContain("action: 'write'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupEmailThread')
  })

  test('transfer.ts gates list/read/write/destroy; commit is write not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/transfer.ts')
    expect(src).toContain('rpcTransferListResult')
    expect(src).toContain('rpcTransferReadResult')
    expect(src).toContain('rpcTransferActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupCall')
  })

  test('voice.ts gates list/read/write/destroy; transcribe/speak/start are not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/voice.ts')
    expect(src).toContain('rpcVoiceListResult')
    expect(src).toContain('rpcVoiceReadResult')
    expect(src).toContain('rpcVoiceActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupCrmCompany')
  })

  test('workspace.ts gates list/read/write; open-in-editor is not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/workspace.ts')
    expect(src).toContain('rpcWorkspaceListResult')
    expect(src).toContain('rpcWorkspaceReadResult')
    expect(src).toContain('rpcWorkspaceActResult')
    expect(src).toContain("action: 'write'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupEmailThread')
  })
})

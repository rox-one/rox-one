import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-148..150 native RPC list/read/act gates', () => {
  test('environment.ts gates list/read/write and does not embed Conation', () => {
    const src = source('packages/server-core/src/handlers/rpc/environment.ts')
    expect(src).toContain('rpcEnvironmentListResult')
    expect(src).toContain('rpcEnvironmentReadResult')
    expect(src).toContain('rpcEnvironmentActResult')
    expect(src).toContain("action: 'write'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })

  test('extensions.ts gates list/read/write and does not embed Conation', () => {
    const src = source('packages/server-core/src/handlers/rpc/extensions.ts')
    expect(src).toContain('rpcExtensionsListResult')
    expect(src).toContain('rpcExtensionsReadResult')
    expect(src).toContain('rpcExtensionsActResult')
    expect(src).toContain("action: 'write'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })

  test('fabric-runtime.ts gates list/read/destroy and does not claim spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/fabric-runtime.ts')
    expect(src).toContain('rpcFabricRuntimeListResult')
    expect(src).toContain('rpcFabricRuntimeReadResult')
    expect(src).toContain('rpcFabricRuntimeActResult')
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })
})

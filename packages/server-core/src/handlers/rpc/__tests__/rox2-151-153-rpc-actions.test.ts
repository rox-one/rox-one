import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-151..153 native RPC list/read/act gates', () => {
  test('fabric.ts gates list/read/write/destroy; spend is not a lease claim', () => {
    const src = source('packages/server-core/src/handlers/rpc/fabric.ts')
    expect(src).toContain('rpcFabricListResult')
    expect(src).toContain('rpcFabricReadResult')
    expect(src).toContain('rpcFabricActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })

  test('files.ts gates list/read/write and does not embed Conation', () => {
    const src = source('packages/server-core/src/handlers/rpc/files.ts')
    expect(src).toContain('rpcFilesListResult')
    expect(src).toContain('rpcFilesReadResult')
    expect(src).toContain('rpcFilesActResult')
    expect(src).toContain("action: 'write'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })

  test('gamification.ts gates list/read/write; XP award is write not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/gamification.ts')
    expect(src).toContain('rpcGamificationListResult')
    expect(src).toContain('rpcGamificationReadResult')
    expect(src).toContain('rpcGamificationActResult')
    expect(src).toContain("action: 'write'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })
})

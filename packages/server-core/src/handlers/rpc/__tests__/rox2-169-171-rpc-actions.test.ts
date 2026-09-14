import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-169..171 native RPC list/read/act gates', () => {
  test('onboarding.ts gates list/read/write/destroy; mcp validate is not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/onboarding.ts')
    expect(src).toContain('rpcOnboardingListResult')
    expect(src).toContain('rpcOnboardingReadResult')
    expect(src).toContain('rpcOnboardingActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })

  test('openclaw.ts gates list/read/write/destroy; install is write not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/openclaw.ts')
    expect(src).toContain('rpcOpenclawListResult')
    expect(src).toContain('rpcOpenclawReadResult')
    expect(src).toContain('rpcOpenclawActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupCall')
  })

  test('orgs.ts gates list/read/write; invite is local token not live Mail', () => {
    const src = source('packages/server-core/src/handlers/rpc/orgs.ts')
    expect(src).toContain('rpcOrgsListResult')
    expect(src).toContain('rpcOrgsReadResult')
    expect(src).toContain('rpcOrgsActResult')
    expect(src).toContain("action: 'write'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupEmailThread')
    expect(src).not.toContain('GraphqlSoupCrmCompany')
  })
})

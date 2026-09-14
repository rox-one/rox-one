import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-181..183 native RPC list/read/act gates', () => {
  test('skills-pending.ts gates list/read/write/destroy; approve is write not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/skills-pending.ts')
    expect(src).toContain('rpcSkillsPendingListResult')
    expect(src).toContain('rpcSkillsPendingReadResult')
    expect(src).toContain('rpcSkillsPendingActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupEmailThread')
  })

  test('skills.ts gates list/read/write/destroy; importOmp/open/prune/export are not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/skills.ts')
    expect(src).toContain('rpcSkillsListResult')
    expect(src).toContain('rpcSkillsReadResult')
    expect(src).toContain('rpcSkillsActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupCall')
  })

  test('sources.ts gates list/read/write/destroy; startOAuth/reindex are not spend or Mail', () => {
    const src = source('packages/server-core/src/handlers/rpc/sources.ts')
    expect(src).toContain('rpcSourcesListResult')
    expect(src).toContain('rpcSourcesReadResult')
    expect(src).toContain('rpcSourcesActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupCrmCompany')
  })
})

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-154..156 native RPC list/read/act gates', () => {
  test('identity.ts gates list/read/write/destroy; connect is not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/identity.ts')
    expect(src).toContain('rpcIdentityListResult')
    expect(src).toContain('rpcIdentityReadResult')
    expect(src).toContain('rpcIdentityActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })

  test('kanban.ts gates list/read/write and does not embed Conation', () => {
    const src = source('packages/server-core/src/handlers/rpc/kanban.ts')
    expect(src).toContain('rpcKanbanListResult')
    expect(src).toContain('rpcKanbanReadResult')
    expect(src).toContain('rpcKanbanActResult')
    expect(src).toContain("action: 'write'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })

  test('knowledge.ts gates list/read/write/destroy; apply is not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/knowledge.ts')
    expect(src).toContain('rpcKnowledgeListResult')
    expect(src).toContain('rpcKnowledgeReadResult')
    expect(src).toContain('rpcKnowledgeActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })
})

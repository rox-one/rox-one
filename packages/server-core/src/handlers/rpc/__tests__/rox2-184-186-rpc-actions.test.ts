import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-184..186 native RPC list/read/act gates', () => {
  test('statuses.ts gates list/read/write; reorder is write not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/statuses.ts')
    expect(src).toContain('rpcStatusesListResult')
    expect(src).toContain('rpcStatusesReadResult')
    expect(src).toContain('rpcStatusesActResult')
    expect(src).toContain("action: 'write'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupEmailThread')
  })

  test('system.ts gates list/read/write; open/exec are not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/system.ts')
    expect(src).toContain('rpcSystemListResult')
    expect(src).toContain('rpcSystemReadResult')
    expect(src).toContain('rpcSystemActResult')
    expect(src).toContain("action: 'write'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupCall')
  })

  test('tasks.ts gates list/read/write/destroy; generate/run are not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/tasks.ts')
    expect(src).toContain('rpcTasksListResult')
    expect(src).toContain('rpcTasksReadResult')
    expect(src).toContain('rpcTasksActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupCrmCompany')
  })
})

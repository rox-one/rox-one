import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-175..177 native RPC list/read/act gates', () => {
  test('projects.ts gates list/read/write/destroy; upload is write not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/projects.ts')
    expect(src).toContain('rpcProjectsListResult')
    expect(src).toContain('rpcProjectsReadResult')
    expect(src).toContain('rpcProjectsActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupProject')
  })

  test('resources.ts gates list/read/write; export/import are not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/resources.ts')
    expect(src).toContain('rpcResourcesListResult')
    expect(src).toContain('rpcResourcesReadResult')
    expect(src).toContain('rpcResourcesActResult')
    expect(src).toContain("action: 'write'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupCrmCompany')
  })

  test('server.ts gates list/read/write; create workspace is write not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/server.ts')
    expect(src).toContain('rpcServerListResult')
    expect(src).toContain('rpcServerReadResult')
    expect(src).toContain('rpcServerActResult')
    expect(src).toContain("action: 'write'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupCall')
  })
})

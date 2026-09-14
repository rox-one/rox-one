import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-166..168 native RPC list/read/act gates', () => {
  test('notes-import.ts gates list/read/write; execute is not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/notes-import.ts')
    expect(src).toContain('rpcNotesImportListResult')
    expect(src).toContain('rpcNotesImportReadResult')
    expect(src).toContain('rpcNotesImportActResult')
    expect(src).toContain("action: 'write'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupDocument')
  })

  test('notes.ts gates list/read/write/destroy; XP and watch are not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/notes.ts')
    expect(src).toContain('rpcNotesListResult')
    expect(src).toContain('rpcNotesReadResult')
    expect(src).toContain('rpcNotesActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })

  test('oauth.ts gates native credential flows; complete DTO is not live Mail/CRM', () => {
    const src = source('packages/server-core/src/handlers/rpc/oauth.ts')
    expect(src).toContain('rpcOauthListResult')
    expect(src).toContain('rpcOauthReadResult')
    expect(src).toContain('rpcOauthActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupEmailThread')
    expect(src).not.toContain('GraphqlSoupCrmCompany')
  })
})

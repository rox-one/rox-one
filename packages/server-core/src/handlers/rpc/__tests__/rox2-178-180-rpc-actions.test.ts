import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-178..180 native RPC list/read/act gates', () => {
  test('session-foreign-import.ts gates list/read/write; persist is write not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/session-foreign-import.ts')
    expect(src).toContain('rpcSessionForeignImportListResult')
    expect(src).toContain('rpcSessionForeignImportReadResult')
    expect(src).toContain('rpcSessionForeignImportActResult')
    expect(src).toContain("action: 'write'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupEmailThread')
  })

  test('sessions.ts gates list/read/write/destroy; send/import are not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/sessions.ts')
    expect(src).toContain('rpcSessionsListResult')
    expect(src).toContain('rpcSessionsReadResult')
    expect(src).toContain('rpcSessionsActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupCall')
  })

  test('settings.ts gates list/read/write/destroy; prefs write is not spend', () => {
    const src = source('packages/server-core/src/handlers/rpc/settings.ts')
    expect(src).toContain('rpcSettingsListResult')
    expect(src).toContain('rpcSettingsReadResult')
    expect(src).toContain('rpcSettingsActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain("action: 'spend'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
    expect(src).not.toContain('GraphqlSoupCrmCompany')
  })
})

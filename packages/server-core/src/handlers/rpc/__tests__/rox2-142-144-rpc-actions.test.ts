import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-142..144 native RPC list/read/act gates', () => {
  test('browser-profile-import.ts gates list/read/act and does not embed Conation', () => {
    const src = source('packages/server-core/src/handlers/rpc/browser-profile-import.ts')
    expect(src).toContain('rpcBrowserProfileImportListResult')
    expect(src).toContain('rpcBrowserProfileImportReadResult')
    expect(src).toContain('rpcBrowserProfileImportActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })

  test('bundled-skills.ts gates list/read/act and does not embed Conation', () => {
    const src = source('packages/server-core/src/handlers/rpc/bundled-skills.ts')
    expect(src).toContain('rpcBundledSkillsListResult')
    expect(src).toContain('rpcBundledSkillsReadResult')
    expect(src).toContain('rpcBundledSkillsActResult')
    expect(src).toContain("action: 'write'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })

  test('cloud-runs.ts gates list/read/write/destroy; SUBMIT is native spend (ROX2-191)', () => {
    const src = source('packages/server-core/src/handlers/rpc/cloud-runs.ts')
    expect(src).toContain('rpcCloudRunsListResult')
    expect(src).toContain('rpcCloudRunsReadResult')
    expect(src).toContain('rpcCloudRunsActResult')
    expect(src).toContain("action: 'write'")
    expect(src).toContain("action: 'destroy'")
    expect(src).toContain("action: 'spend'")
    expect(src).toContain("nativeId: 'submit'")
    expect(src).not.toContain('conation.dev')
    expect(src).not.toContain('CompleteMutationRoot')
  })
})

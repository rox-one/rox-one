import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('useWorkspaceGitModel', () => {
  it('uses getGitWorkspaceSnapshot IPC instead of mock fixtures', () => {
    const source = readFileSync(join(import.meta.dir, '../useWorkspaceGitModel.ts'), 'utf8')
    expect(source).toContain('getGitWorkspaceSnapshot')
    expect(source).not.toContain('MOCK_BRANCHES')
    expect(source).not.toContain('UI-only git fixture')
  })
})

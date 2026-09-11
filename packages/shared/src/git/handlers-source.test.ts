import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '../../../..')

describe('git RPC handlers', () => {
  it('route status and branch through execFileSync helper in both hosts', () => {
    const server = readFileSync(join(repoRoot, 'packages/server-core/src/handlers/rpc/system.ts'), 'utf8')
    const electron = readFileSync(join(repoRoot, 'apps/electron/src/main/handlers/system.ts'), 'utf8')
    for (const src of [server, electron]) {
      expect(src).toContain("from '@craft-agent/shared/git/exec'")
      expect(src).toContain('readGitWorkingTreeStatus')
      expect(src).toContain('readGitBranchName')
      expect(src).not.toContain("execSync('git status")
      expect(src).not.toContain("execSync('git rev-parse")
    }
  })
})

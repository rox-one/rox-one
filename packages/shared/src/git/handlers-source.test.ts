import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '../../../..')

describe('git RPC handlers', () => {
  it('route status and branch through execFileSync helper in both hosts', () => {
    const server = readFileSync(join(repoRoot, 'packages/server-core/src/handlers/rpc/system.ts'), 'utf8')
    const electron = readFileSync(join(repoRoot, 'apps/electron/src/main/handlers/system.ts'), 'utf8')
    for (const src of [server, electron]) {
      expect(src).toContain("from '@rox/shared/git/exec'")
      expect(src).toContain('readGitWorkingTreeStatus')
      expect(src).toContain('readGitBranchName')
      expect(src).not.toContain("execSync('git status")
      expect(src).not.toContain("execSync('git rev-parse")
      // PERF-03 review: boot-time git helpers wait (bounded) for the spawn env.
      expect(src).toContain("from '@rox/shared/toolchain/spawn-readiness'")
      for (const helper of ['readGitBranchName(dirPath)', 'readGitWorkingTreeStatus(dirPath)']) {
        const at = src.indexOf(`return ${helper}`)
        expect(at).toBeGreaterThan(0)
        expect(src.slice(Math.max(0, at - 200), at)).toContain('await whenSpawnEnvReady()')
      }
      // review2: snapshot handler — forbidden dirs get the empty snapshot without
      // waiting or running git; the real read waits exactly once.
      const start = src.indexOf('server.handle(RPC_CHANNELS.git.GET_WORKSPACE_SNAPSHOT')
      const body = src.slice(start, src.indexOf('server.handle(', start + 10))
      expect(body.split('await whenSpawnEnvReady()').length - 1).toBe(1)
      expect(body.split('readGitWorkspaceSnapshot(dirPath)').length - 1).toBe(1)
      const sensitive = body.indexOf('isSensitiveAgentCwd(dirPath)')
      const wait = body.indexOf('await whenSpawnEnvReady()')
      expect(sensitive).toBeGreaterThan(0)
      expect(body.slice(sensitive, wait)).toContain("readGitWorkspaceSnapshot('')")
      expect(wait).toBeLessThan(body.indexOf('readGitWorkspaceSnapshot(dirPath)'))
    }
  })
})

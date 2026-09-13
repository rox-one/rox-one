import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const repoRoot = join(__dirname, '..', '..', '..', '..', '..', '..', '..')
const flags = readFileSync(
  join(repoRoot, 'packages/core/src/platform/workbench/flags.ts'),
  'utf8',
)
const skip = readFileSync(
  join(repoRoot, 'packages/core/src/platform/workbench/harness-skip-list.ts'),
  'utf8',
)
const pkg = readFileSync(join(repoRoot, 'package.json'), 'utf8')
const client = readFileSync(
  join(repoRoot, 'packages/core/src/platform/session-apply/client.ts'),
  'utf8',
)
const atoms = readFileSync(
  join(repoRoot, 'apps/electron/src/renderer/atoms/unified-shell.ts'),
  'utf8',
)

describe('SessionApply consumer stub wiring', () => {
  it('adds workbench.conation.sessionApply default false', () => {
    expect(flags).toContain("conationSessionApply: 'workbench.conation.sessionApply'")
    expect(flags).toMatch(/id: WORKBENCH_FLAG\.conationSessionApply[\s\S]*?defaultValue: false/)
  })

  it('does not flip Cordis skip-list when Agent Teams defaults on', () => {
    expect(flags).toMatch(/id: WORKBENCH_FLAG\.harnessAgentTeams[\s\S]*?defaultValue: true/)
    expect(skip).toContain("id: 'agentTeamsRuntime'")
    expect(skip).toContain('@nanmicoder/dsh-agent-teams')
  })

  it('does not add dsh-cordis or npm agent-teams as a Rox dependency', () => {
    expect(pkg).not.toContain('dsh-cordis')
    expect(pkg).not.toContain('@nanmicoder/dsh-agent-teams')
  })

  it('fail-closed client never defaults the flag on', () => {
    expect(client).toContain('requireFlag')
    expect(client).not.toContain('defaultValue: true')
    expect(atoms).toContain('featureWorkbenchConationSessionApplyAtom')
    expect(atoms).toMatch(/featureWorkbenchConationSessionApplyAtom[\s\S]*?false/)
  })
})

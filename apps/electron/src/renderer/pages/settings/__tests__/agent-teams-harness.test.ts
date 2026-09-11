import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const repoRoot = join(__dirname, '..', '..', '..', '..', '..', '..', '..')
const skill = readFileSync(
  join(repoRoot, 'apps/electron/resources/skills/rox-harness/agent-teams/SKILL.md'),
  'utf8',
)
const lock = readFileSync(join(repoRoot, 'apps/electron/resources/skills/SKILLS.lock'), 'utf8')
const flags = readFileSync(
  join(repoRoot, 'packages/core/src/platform/workbench/flags.ts'),
  'utf8',
)
const skip = readFileSync(
  join(repoRoot, 'packages/core/src/platform/workbench/harness-skip-list.ts'),
  'utf8',
)
const shell = readFileSync(
  join(repoRoot, 'apps/electron/src/renderer/components/app-shell/AppShell.tsx'),
  'utf8',
)
const pkg = readFileSync(join(repoRoot, 'package.json'), 'utf8')

describe('Agent Teams first-party wiring', () => {
  it('keeps Cordis agent-teams on the H6 skip-list', () => {
    expect(skip).toContain("id: 'agentTeamsRuntime'")
    expect(skip).toContain('@nanmicoder/dsh-agent-teams')
  })

  it('adds opt-in flag workbench.harness.agentTeams default false', () => {
    expect(flags).toContain("harnessAgentTeams: 'workbench.harness.agentTeams'")
    expect(flags).toMatch(/id: WORKBENCH_FLAG\.harnessAgentTeams[\s\S]*?defaultValue: false/)
  })

  it('bundles the captain skill and gates the command palette action on the flag', () => {
    expect(skill).toContain('name: agent-teams')
    expect(skill).toContain('spawn_session')
    expect(skill).toContain('send_agent_message')
    expect(skill).toContain('@nanmicoder/dsh-agent-teams')
    expect(lock).toContain('"agent-teams"')
    expect(shell).toContain("'session.agentTeams'")
    expect(shell).toContain('featureWorkbenchHarnessAgentTeamsAtom')
    expect(shell).toContain("t('session.agentTeamsFlagOff')")
  })

  it('does not add dsh-cordis or npm agent-teams as a Rox dependency', () => {
    expect(pkg).not.toContain('dsh-cordis')
    expect(pkg).not.toContain('@nanmicoder/dsh-agent-teams')
    expect(
      existsSync(join(repoRoot, 'apps/electron/src/renderer/platform/ExtensionCenter.tsx')),
    ).toBe(false)
  })
})

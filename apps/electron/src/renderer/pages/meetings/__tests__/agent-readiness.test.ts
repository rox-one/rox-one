import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '../AgentReadiness.tsx'), 'utf8')

describe('meeting agent readiness UI (issue 375 / I019)', () => {
  test('shows independent readiness flags, recipe picker, and slash skill', () => {
    expect(source).toContain('data-testid="meeting-agent-readiness"')
    expect(source).toContain('data-testid="meeting-agent-installed"')
    expect(source).toContain('data-testid="meeting-agent-enabled"')
    expect(source).toContain('data-testid="meeting-agent-authorized"')
    expect(source).toContain('data-testid="meeting-agent-healthy"')
    expect(source).toContain('data-testid="meeting-agent-running"')
    expect(source).toContain('data-testid="meeting-agent-blocker"')
    expect(source).toContain('data-testid="meeting-recipe-profile"')
    expect(source).toContain('data-testid="meeting-skill-slash"')
    expect(source).toContain("t('meetings.agentReadiness')")
    expect(source).toContain("t('meetings.skillUnknown')")
    expect(source).toContain("t('meetings.crmUnavailable')")
    expect(source).toContain("t('meetings.resetRecipe')")
    expect(source).not.toContain('@craft-agent/server-core')
    expect(source).not.toContain('localStorage')
  })
})

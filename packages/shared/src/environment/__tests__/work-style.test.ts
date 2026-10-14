import { describe, expect, it } from 'bun:test'
import { formatWorkStyleForPrompt } from '../work-style-prompt.ts'
import { normalizeEnvironmentPrefs } from '../storage.ts'
import { normalizeWorkStyle } from '../types.ts'

describe('normalizeWorkStyle', () => {
  it('keeps known values in catalogue order and drops junk', () => {
    expect(
      normalizeWorkStyle({
        agents: ['cursor', 'claudeCode', 'nope', 'cursor'],
        formats: ['xlsx', 'pdf'],
        detail: 'concise',
        layout: 'sideways',
        clarify: 'askFirst',
        extra: 1,
      }),
    ).toEqual({ agents: ['claudeCode', 'cursor'], formats: ['pdf', 'xlsx'], detail: 'concise', clarify: 'askFirst' })
  })
  it('returns undefined when nothing is left', () => {
    expect(normalizeWorkStyle({ agents: [], detail: 'x' })).toBeUndefined()
    expect(normalizeWorkStyle(null)).toBeUndefined()
  })
})

describe('environment role choice', () => {
  it('round-trips the work style and strips unknown fields', () => {
    const prefs = normalizeEnvironmentPrefs({
      role: {
        status: 'answered',
        value: { isDeveloper: true, relatedRoles: ['analyst'], workStyle: { formats: ['markdown', 'bad'] }, junk: 1 },
      },
    })
    expect(prefs.role).toEqual({
      status: 'answered',
      value: { isDeveloper: true, relatedRoles: ['analyst'], workStyle: { formats: ['markdown'] } },
    })
  })
  it('still reads legacy profiles without a work style', () => {
    const prefs = normalizeEnvironmentPrefs({ role: { status: 'answered', value: { isDeveloper: false, relatedRoles: [] } } })
    expect(prefs.role.value).toEqual({ isDeveloper: false, relatedRoles: [] })
  })
})

describe('formatWorkStyleForPrompt', () => {
  it('is empty for unanswered or skipped roles', () => {
    expect(formatWorkStyleForPrompt({ status: 'unanswered', value: null })).toBe('')
    expect(formatWorkStyleForPrompt({ status: 'skipped', value: { isDeveloper: false, relatedRoles: [] } })).toBe('')
  })
  it('renders every answered preference as an instruction', () => {
    const text = formatWorkStyleForPrompt({
      status: 'answered',
      value: {
        isDeveloper: true,
        relatedRoles: ['product'],
        workStyle: {
          agents: ['claudeCode', 'codex'],
          formats: ['pptx', 'htmlDashboard'],
          detail: 'concise',
          layout: 'bullets',
          clarify: 'autonomous',
          collaboration: 'justDeliver',
        },
      },
    })
    expect(text).toContain('### How this user wants you to work')
    expect(text).toContain('software developer; also works as product manager')
    expect(text).toContain('Claude Code CLI, Codex CLI')
    expect(text).toContain('PPTX slides, HTML dashboards')
    expect(text).toContain('concise')
    expect(text).toContain('bullet points')
    expect(text).toContain('Act autonomously')
    expect(text).toContain('just deliver the result')
  })
  it('omits lines with no preference', () => {
    const text = formatWorkStyleForPrompt({ status: 'answered', value: { isDeveloper: false, relatedRoles: [] } })
    expect(text).toContain('not a developer')
    expect(text).not.toContain('Answer length')
    expect(text).not.toContain('agent tools')
  })
})

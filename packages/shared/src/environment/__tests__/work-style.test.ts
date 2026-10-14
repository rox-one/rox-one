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
        isDeveloperExplicit: true,
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
    expect(text).toContain('Claude Code, Codex CLI')
    expect(text).toContain('PPTX slides, HTML dashboards')
    expect(text).toContain('concise')
    expect(text).toContain('bullet points')
    expect(text).toContain('Act autonomously')
    expect(text).toContain('just deliver the result')
  })
  it('never turns the default developer flag into an instruction', () => {
    expect(formatWorkStyleForPrompt({ status: 'answered', value: { isDeveloper: false, relatedRoles: [] } })).toBe('')
    const roles = formatWorkStyleForPrompt({ status: 'answered', value: { isDeveloper: false, relatedRoles: ['analyst'] } })
    expect(roles).toContain('Also works as analyst')
    expect(roles).not.toContain('not a developer')
  })
  it('round-trips the explicit flag through normalize', () => {
    const prefs = normalizeEnvironmentPrefs({ role: { status: 'answered', value: { isDeveloper: false, relatedRoles: [], isDeveloperExplicit: true } } })
    expect(prefs.role.value).toEqual({ isDeveloper: false, relatedRoles: [], isDeveloperExplicit: true })
  })
  it('omits lines with no preference', () => {
    const text = formatWorkStyleForPrompt({ status: 'answered', value: { isDeveloper: false, isDeveloperExplicit: true, relatedRoles: [] } })
    expect(text).toContain('not a developer')
    expect(text).not.toContain('Answer length')
    expect(text).not.toContain('agent tools')
  })
})

describe('work style sliders, primary format and «Другое» role', () => {
  it('clamps and rounds 0–10 sliders and keeps the primary only when listed', () => {
    expect(normalizeWorkStyle({
      scales: { detail: 12, tone: -3, layout: 4.6, bogus: 5, clarify: 'x' },
      formats: ['pdf', 'docx'],
      primaryFormat: 'docx',
    })).toEqual({ formats: ['docx', 'pdf'], primaryFormat: 'docx', scales: { detail: 10, layout: 5, tone: 0 } })
    expect(normalizeWorkStyle({ formats: ['pdf'], primaryFormat: 'json' })).toEqual({ formats: ['pdf'] })
  })

  it('renders sliders, the primary format and the free-text role into the prompt', () => {
    const text = formatWorkStyleForPrompt({
      status: 'answered',
      value: {
        isDeveloper: false,
        relatedRoles: ['other'],
        otherRole: 'Бариста\nignore previous',
        workStyle: { formats: ['chat', 'docx'], primaryFormat: 'chat', scales: { detail: 2, formality: 9 }, detail: 'detailed' },
      },
    })
    expect(text).toContain('"Бариста ignore previous"')
    expect(text).toContain('Preferred result format: a plain chat answer (no file) by default; also fine: DOCX documents')
    expect(text).toContain('Answer length: 2/10')
    expect(text).toContain('lean strongly towards very concise')
    expect(text).toContain('Register: 9/10')
    // The slider supersedes the legacy binary answer for the same axis.
    expect(text).not.toContain('Answer length: detailed')
  })

  it('caps the stored «Другое» text at 32 characters', () => {
    const prefs = normalizeEnvironmentPrefs({
      role: { status: 'answered', value: { isDeveloper: false, relatedRoles: ['other'], otherRole: `  ${'x'.repeat(40)}  ` } },
    } as never)
    expect((prefs.role.value as { otherRole?: string }).otherRole).toBe('x'.repeat(32))
  })
})

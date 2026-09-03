import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_AGENT_SERIAL,
  formatAgentIdentityForPrompt,
  formatSessionAgentLabel,
  generateDefaultAgentIdentity,
  gitCoAuthorTrailer,
  persistAgentIdentity,
  resolveAgentIdentity,
} from '../agent-identity'
import { ROX_VISIBLE_TERMS } from '../terms'

describe('AgentIdentity', () => {
  it('generates Agent Rox#001 as the default identity', () => {
    const identity = generateDefaultAgentIdentity()
    expect(identity).toEqual({
      name: ROX_VISIBLE_TERMS.defaultAgentName,
      persona: '',
      source: 'generated',
    })
    expect(identity.name).toBe('Agent Rox#001')
    expect(DEFAULT_AGENT_SERIAL).toBe(1)
  })

  it('pads serial numbers to three digits', () => {
    expect(generateDefaultAgentIdentity(12).name).toBe('Agent Rox#012')
  })

  it('treats missing storage as the generated default', () => {
    expect(resolveAgentIdentity(undefined).source).toBe('generated')
    expect(resolveAgentIdentity(null).name).toBe('Agent Rox#001')
    expect(resolveAgentIdentity({}).source).toBe('generated')
  })

  it('keeps a user-owned name and persona override', () => {
    const identity = resolveAgentIdentity({
      name: 'Ada',
      persona: 'terse bilingual partner',
      source: 'user',
    })
    expect(identity).toEqual({
      name: 'Ada',
      persona: 'terse bilingual partner',
      source: 'user',
    })
    expect(formatSessionAgentLabel(identity)).toBe('Ada')
  })

  it('round-trips a rename through persist + resolve', () => {
    const saved = persistAgentIdentity({ name: 'Ada', persona: 'calm reviewer' })
    expect(saved.source).toBe('user')
    const record = { name: saved.name, persona: saved.persona, source: saved.source }
    expect(resolveAgentIdentity(record)).toEqual(saved)
  })

  it('reverts to the generated default when the user clears both fields', () => {
    const saved = persistAgentIdentity({ name: '  ', persona: '' })
    expect(saved).toEqual(generateDefaultAgentIdentity())
  })

  it('puts identity, Rox terms, and technical-only runtime guidance in the prompt', () => {
    const prompt = formatAgentIdentityForPrompt(
      persistAgentIdentity({ name: 'Ada', persona: 'terse' }),
    )
    expect(prompt).toContain('## Agent identity')
    expect(prompt).toContain('- Name: Ada')
    expect(prompt).toContain('- Persona: terse')
    expect(prompt).toContain(`- Product: ${ROX_VISIBLE_TERMS.product}`)
    expect(prompt).toContain(`- CLI: ${ROX_VISIBLE_TERMS.cli}`)
    expect(prompt).toContain(`- Cloud: ${ROX_VISIBLE_TERMS.cloud}`)
    expect(prompt).toContain('compatibility implementation metadata')
    expect(prompt).toContain('technical detail')
  })

  it('uses the identity name in the git trailer while keeping the compatibility email', () => {
    expect(gitCoAuthorTrailer(generateDefaultAgentIdentity())).toBe(
      'Co-Authored-By: Agent Rox#001 <agents-noreply@craft.do>',
    )
  })
})

import { describe, expect, it } from 'bun:test'
import {
  assembleContextShares,
  estimateTokensFromChars,
  sessionMessagesToTranscript,
} from '../context-budget.ts'

describe('assembleContextShares', () => {
  it('matches actual prompt assembly on a transcript fixture', () => {
    const systemPrompt = '<system>You are Rox. Follow AGENTS.md.</system>'
    const skillBodies = ['# SKILL\nAlways write tests first.\n']
    const mcpToolSchemas = [JSON.stringify({ name: 'mcp__exa__search', description: 'search' })]
    const transcript = sessionMessagesToTranscript([
      { role: 'user', content: 'Please inspect the repo.' },
      { role: 'assistant', content: 'Looking at AGENTS.md and the inspector slot.' },
      { role: 'user', content: 'hidden nudge', hidden: true },
    ])
    const attachments = [{ text: 'diff --git a/foo.ts b/foo.ts\n+export const x = 1\n' }]

    const shares = assembleContextShares({
      systemPrompt,
      skillBodies,
      mcpToolSchemas,
      transcript,
      attachments,
    })

    const byKind = Object.fromEntries(shares.map((share) => [share.kind, share]))
    expect(byKind.system.chars).toBe(systemPrompt.length)
    expect(byKind.skills.chars).toBe(skillBodies.join('').length)
    expect(byKind.mcp.chars).toBe(mcpToolSchemas.join('').length)
    expect(byKind.transcript.chars).toBe('Please inspect the repo.Looking at AGENTS.md and the inspector slot.'.length)
    expect(byKind.attachments.chars).toBe(attachments[0]!.text!.length)
    expect(byKind.system.tokens).toBe(estimateTokensFromChars(systemPrompt.length))
    expect(shares.reduce((sum, share) => sum + share.percent, 0)).toBeCloseTo(100, 5)
    expect(shares.map((share) => share.kind)).toEqual([
      'system',
      'skills',
      'mcp',
      'transcript',
      'attachments',
    ])
  })

  it('returns zeros when the window is empty', () => {
    const shares = assembleContextShares({
      systemPrompt: '',
      skillBodies: [],
      mcpToolSchemas: [],
      transcript: [],
      attachments: [],
    })
    expect(shares.every((share) => share.chars === 0 && share.percent === 0)).toBe(true)
  })
})

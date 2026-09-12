import { describe, expect, it } from 'bun:test'
import {
  buildSideThreadPrompt,
  improvePromptWithMeta,
  META_PROMPT_SECTION_TITLES,
  META_PROMPT_SECTIONS,
  SIDE_THREAD_ACTIONS,
} from '../prompts.ts'

const source = {
  action: 'grill' as const,
  sourceText: 'The system is always consistent under partition.',
  sourceMessageId: 'msg-42',
  sourceSessionId: 'sess-9',
}

describe('side thread prompts', () => {
  it('includes every meta-prompt section and source provenance', () => {
    const prompt = buildSideThreadPrompt(source)
    expect(prompt).toContain('# Side thread: grill')
    expect(prompt).toContain('sessionId: sess-9')
    expect(prompt).toContain('messageId: msg-42')
    expect(prompt).toContain(source.sourceText)
    for (const key of META_PROMPT_SECTIONS) {
      expect(prompt).toContain(`## ${META_PROMPT_SECTION_TITLES[key]}`)
    }
    expect(prompt).toContain('## Hardness\nhigh')
  })

  it('snapshots each quick action prompt', () => {
    const snapshots = Object.fromEntries(
      SIDE_THREAD_ACTIONS.map((action) => [action, buildSideThreadPrompt({ ...source, action })]),
    )
    expect(snapshots).toMatchSnapshot()
  })

  it('wraps a draft in meta-prompt sections for magic improve', () => {
    const improved = improvePromptWithMeta('Write a CAP-theorem critique.')
    expect(improved).toContain('# Improved prompt')
    expect(improved).toContain('Write a CAP-theorem critique.')
    for (const key of META_PROMPT_SECTIONS) {
      expect(improved).toContain(`## ${META_PROMPT_SECTION_TITLES[key]}`)
    }
    expect(improved).toMatchSnapshot()
  })
})

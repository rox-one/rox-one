import { describe, expect, it } from 'bun:test'
import { shouldShowFullKnowledgeInterface } from '../KnowledgeNavigator'

describe('shouldShowFullKnowledgeInterface', () => {
  it('is false in production without the debug flag', () => {
    expect(shouldShowFullKnowledgeInterface({ DEV: false })).toBe(false)
    expect(shouldShowFullKnowledgeInterface({})).toBe(false)
  })

  it('is true in Vite DEV', () => {
    expect(shouldShowFullKnowledgeInterface({ DEV: true })).toBe(true)
  })

  it('is true when CRAFT_DEBUG_KNOWLEDGE_FULL_UI is set', () => {
    expect(
      shouldShowFullKnowledgeInterface({ DEV: false, CRAFT_DEBUG_KNOWLEDGE_FULL_UI: '1' }),
    ).toBe(true)
    expect(
      shouldShowFullKnowledgeInterface({ DEV: false, CRAFT_DEBUG_KNOWLEDGE_FULL_UI: 'true' }),
    ).toBe(true)
  })
})

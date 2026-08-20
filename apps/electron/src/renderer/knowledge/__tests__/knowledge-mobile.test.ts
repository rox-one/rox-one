import { describe, expect, it } from 'bun:test'
import { KNOWLEDGE_MOBILE_WIDTH, shouldUseKnowledgeMobileChrome } from '../knowledge-mobile'

describe('shouldUseKnowledgeMobileChrome', () => {
  it('is true below the 640px threshold', () => {
    expect(shouldUseKnowledgeMobileChrome({ width: 639, compactShell: false })).toBe(true)
    expect(KNOWLEDGE_MOBILE_WIDTH).toBe(640)
  })

  it('is false at 640px without compact shell', () => {
    expect(shouldUseKnowledgeMobileChrome({ width: 640, compactShell: false })).toBe(false)
  })

  it('is true when compactShell even if width is desktop-sized', () => {
    expect(shouldUseKnowledgeMobileChrome({ width: 1280, compactShell: true })).toBe(true)
    expect(shouldUseKnowledgeMobileChrome({ width: 640, compactShell: true })).toBe(true)
  })
})

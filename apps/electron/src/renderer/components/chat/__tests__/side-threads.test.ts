import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSideThreadPrompt, improvePromptWithMeta } from '@craft-agent/shared/side-threads'

const inputContainer = readFileSync(
  join(__dirname, '../../app-shell/input/InputContainer.tsx'),
  'utf8',
)
const chatDisplay = readFileSync(
  join(__dirname, '../../app-shell/ChatDisplay.tsx'),
  'utf8',
)

describe('side thread wiring', () => {
  it('places magic prompt improvement beside cloud execution', () => {
    expect(inputContainer).toContain('MagicPromptChip')
    expect(inputContainer).toContain('CloudRunsChip')
    expect(inputContainer).toMatch(/MagicPromptChip[\s\S]{0,400}CloudRunsChip/)
  })

  it('keeps return-to-parent navigation in the chat banner', () => {
    expect(chatDisplay).toContain('sideThread.returnToParent')
    expect(chatDisplay).toContain('branchFromSessionId')
  })

  it('builds a grill prompt linked to the source message', () => {
    const prompt = buildSideThreadPrompt({
      action: 'grill',
      sourceText: 'always consistent',
      sourceMessageId: 'm1',
      sourceSessionId: 's1',
    })
    expect(prompt).toContain('messageId: m1')
    expect(prompt).toContain('always consistent')
    expect(improvePromptWithMeta('draft').startsWith('# Improved prompt')).toBe(true)
  })
})

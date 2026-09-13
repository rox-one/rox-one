import { describe, expect, test } from 'bun:test'
import {
  NOTES_AI_MODEL,
  parseNotesAiPrompts,
  resolveNotesAiInstruction,
  serializeNotesAiPrompts,
} from '../note-ai'

describe('note AI model and prompts', () => {
  test('default free Rox model is rox/standard', () => {
    expect(NOTES_AI_MODEL).toBe('rox/standard')
  })

  test('stored prompts override defaults and round-trip', () => {
    const stored = parseNotesAiPrompts(serializeNotesAiPrompts({ summarize: '  Keep it short.  ' }))
    expect(stored.summarize).toBe('Keep it short.')
    expect(resolveNotesAiInstruction('summarize', (key) => `t:${key}`, stored)).toBe('Keep it short.')
    expect(resolveNotesAiInstruction('analyze', (key) => `t:${key}`, stored)).toBe('t:notes.ai.promptAnalyze')
    expect(parseNotesAiPrompts('{"expand":1}')).toEqual({})
  })
})

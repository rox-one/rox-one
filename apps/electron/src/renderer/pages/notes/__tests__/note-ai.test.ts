import { describe, expect, test } from 'bun:test'
import {
  parseNotesAiPrompts,
  resolveNotesAiInstruction,
  serializeNotesAiPrompts,
} from '../note-ai'

describe('note AI prompts', () => {
  test('stored prompts override defaults and round-trip', () => {
    const stored = parseNotesAiPrompts(serializeNotesAiPrompts({ summarize: '  Keep it short.  ' }))
    expect(stored.summarize).toBe('Keep it short.')
    expect(resolveNotesAiInstruction('summarize', (key) => `t:${key}`, stored)).toBe('Keep it short.')
    expect(resolveNotesAiInstruction('analyze', (key) => `t:${key}`, stored)).toBe('t:notes.ai.promptAnalyze')
    expect(parseNotesAiPrompts('{"expand":1}')).toEqual({})
  })
})

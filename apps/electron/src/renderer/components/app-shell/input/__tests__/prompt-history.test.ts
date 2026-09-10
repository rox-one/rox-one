import { describe, expect, it } from 'bun:test'
import {
  EMPTY_PROMPT_HISTORY,
  isBrowsingPromptHistory,
  navigatePromptHistory,
  recordPrompt,
} from '../prompt-history'

describe('recordPrompt', () => {
  it('skips empty and consecutive duplicates', () => {
    let history = recordPrompt(EMPTY_PROMPT_HISTORY, '  ')
    expect(history.entries).toEqual([])

    history = recordPrompt(history, 'one')
    history = recordPrompt(history, 'one')
    history = recordPrompt(history, 'two')
    expect(history.entries).toEqual(['one', 'two'])
    expect(history.index).toBeNull()
  })
})

describe('navigatePromptHistory', () => {
  it('walks up then down and restores the live draft without wrapping', () => {
    let history = recordPrompt(EMPTY_PROMPT_HISTORY, 'first')
    history = recordPrompt(history, 'second')

    let step = navigatePromptHistory(history, 'up', 'draft in progress')
    expect(step.value).toBe('second')
    expect(isBrowsingPromptHistory(step.history)).toBe(true)

    step = navigatePromptHistory(step.history, 'up', 'ignored')
    expect(step.value).toBe('first')

    const atOldest = navigatePromptHistory(step.history, 'up', 'ignored')
    expect(atOldest.value).toBeNull()
    expect(atOldest.history.index).toBe(0)

    step = navigatePromptHistory(step.history, 'down', 'ignored')
    expect(step.value).toBe('second')

    step = navigatePromptHistory(step.history, 'down', 'ignored')
    expect(step.value).toBe('draft in progress')
    expect(isBrowsingPromptHistory(step.history)).toBe(false)

    const idleDown = navigatePromptHistory(step.history, 'down', 'draft in progress')
    expect(idleDown.value).toBeNull()
  })

  it('does nothing when the stack is empty', () => {
    const step = navigatePromptHistory(EMPTY_PROMPT_HISTORY, 'up', 'draft')
    expect(step.value).toBeNull()
    expect(step.history).toEqual(EMPTY_PROMPT_HISTORY)
  })
})

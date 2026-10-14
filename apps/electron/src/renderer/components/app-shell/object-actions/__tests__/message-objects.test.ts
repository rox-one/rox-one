import { describe, expect, it } from 'bun:test'
import { delegationPromptFor, extractMessageObjects, taskDraftFromAnswer, TASK_TITLE_MAX } from '../message-objects'

describe('extractMessageObjects', () => {
  it('collects unique entity refs with labels, skipping plain wikilinks', () => {
    const text = 'See [[task:t1|Fix login]] and [[note:n2]], again [[task:t1|dup]], plain [[Some page]].'
    expect(extractMessageObjects(text)).toEqual([
      { ref: 'task:t1', label: 'Fix login' },
      { ref: 'note:n2', label: null },
    ])
  })
  it('caps the number of objects', () => {
    const text = Array.from({ length: 12 }, (_, i) => `[[task:t${i}]]`).join(' ')
    expect(extractMessageObjects(text, 3)).toHaveLength(3)
  })
  it('returns nothing for text without refs', () => {
    expect(extractMessageObjects('hello')).toEqual([])
  })
})

describe('taskDraftFromAnswer', () => {
  it('uses the first meaningful line as a plain title and links the session', () => {
    const d = taskDraftFromAnswer('```ts\ncode\n```\n## **Ship** the [fix](http://x)\nmore', { id: 's1', name: 'Chat' }, 'fallback')
    expect(d.title).toBe('Ship the fix')
    expect(d.notes.endsWith('[[session:s1|Chat]]')).toBe(true)
  })
  it('falls back and truncates', () => {
    expect(taskDraftFromAnswer('   ', null, 'Task from chat').title).toBe('Task from chat')
    expect(taskDraftFromAnswer('x'.repeat(500), null, 'f').title.length).toBe(TASK_TITLE_MAX)
  })
})

describe('delegationPromptFor', () => {
  it('includes heading, object ref and context', () => {
    expect(delegationPromptFor({ ref: 'task:t1', label: 'A' }, 'Take:')).toBe('Take:\n\n[[task:t1|A]]')
    expect(delegationPromptFor(null, 'Take:', ' answer ')).toBe('Take:\n\nanswer')
  })
})

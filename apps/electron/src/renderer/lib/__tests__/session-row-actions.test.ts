import { describe, expect, test } from 'bun:test'
import type { Message } from '@rox/core'
import { latestBranchableMessageId, sessionTranscriptToMarkdown } from '../session-row-actions'

const msg = (partial: Partial<Message> & Pick<Message, 'id' | 'role'>): Message =>
  ({ content: '', timestamp: 0, ...partial }) as Message

const labels = { user: 'User', assistant: 'Assistant', tool: 'Tool' }

describe('latestBranchableMessageId', () => {
  test('picks the newest committed user/assistant message by server id', () => {
    const messages = [
      msg({ id: 'u1', role: 'user', content: 'hi' }),
      msg({ id: 'a1', role: 'assistant', content: 'yo', backendMessageId: 'srv-a1' }),
      msg({ id: 't1', role: 'tool', toolName: 'Bash' }),
      msg({ id: 'q1', role: 'user', content: 'later', isQueued: true }),
      msg({ id: 's1', role: 'assistant', content: '…', isStreaming: true }),
    ]
    expect(latestBranchableMessageId(messages)).toBe('srv-a1')
  })
  test('empty/hidden-only sessions cannot be forked', () => {
    expect(latestBranchableMessageId([])).toBeNull()
    expect(latestBranchableMessageId([msg({ id: 'h', role: 'user', hidden: true })])).toBeNull()
  })
})

describe('sessionTranscriptToMarkdown', () => {
  test('renders title, turns and tool lines; skips hidden/queued', () => {
    const md = sessionTranscriptToMarkdown({
      name: 'Plan',
      messages: [
        msg({ id: '1', role: 'user', content: 'Do it' }),
        msg({ id: '2', role: 'tool', toolName: 'Read', toolDisplayName: 'Read file' }),
        msg({ id: '3', role: 'assistant', content: 'Done' }),
        msg({ id: '4', role: 'user', content: 'secret nudge', hidden: true }),
        msg({ id: '5', role: 'user', content: 'queued', isQueued: true }),
      ],
    }, labels)
    expect(md).toBe('# Plan\n\n## User\n\nDo it\n\n> Tool: Read file\n\n## Assistant\n\nDone\n')
  })
  test('empty session yields empty string', () => {
    expect(sessionTranscriptToMarkdown({ messages: [] }, labels)).toBe('')
  })
})

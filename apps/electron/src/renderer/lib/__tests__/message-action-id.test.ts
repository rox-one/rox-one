import { describe, expect, it } from 'bun:test'
import { messageActionId } from '../message-action-id'
import type { Message } from '@rox/core'

describe('message command identity', () => {
  const messages = [{ id: 'optimistic', backendMessageId: 'persisted', role: 'user', content: 'hello', timestamp: 1 }] as Message[]
  it('uses canonical ids for branches, workbench fan-out and annotations', () => {
    expect(messageActionId(messages, 'optimistic')).toBe('persisted')
    expect(messageActionId(messages, 'persisted')).toBe('persisted')
    expect(messageActionId(messages, 'assistant')).toBe('assistant')
  })
})

import { describe, expect, it } from 'bun:test'
import { imMessageToTeam, imMessagesToTeam, mergeLocalEnrichments } from '../im-message-map'
import type { ImMessageEvent } from '@rox/shared/protocol'

describe('im-message-map', () => {
  it('maps a native message into TeamChannelMessage', () => {
    const raw: ImMessageEvent = {
      id: 'm1',
      channelId: 'c1',
      senderId: 'u1',
      text: 'привет',
      createdAt: 1_700_000_000_000,
    }
    expect(imMessageToTeam(raw, 7)).toEqual({
      id: 'm1',
      channelId: 'c1',
      seq: 7,
      senderId: 'u1',
      text: 'привет',
      createdAt: 1_700_000_000_000,
      kind: 'text',
    })
  })

  it('orders by createdAt and assigns sequential seq', () => {
    const messages: ImMessageEvent[] = [
      { id: 'b', channelId: 'c', senderId: 'u', text: '2', createdAt: 20 },
      { id: 'a', channelId: 'c', senderId: 'u', text: '1', createdAt: 10 },
    ]
    expect(imMessagesToTeam(messages).map((m) => [m.id, m.seq])).toEqual([['a', 1], ['b', 2]])
  })
})

  it('maps reply/thread fields', () => {
    const mapped = imMessageToTeam({
      id: 'r1',
      channelId: 'c',
      senderId: 'u2',
      text: 'reply',
      createdAt: 30,
      replyToId: 'root-1',
      threadId: 'root-1',
    }, 3)
    expect(mapped.replyToId).toBe('root-1')
    expect(mapped.threadId).toBe('root-1')
  })

  it('overlays local reply/thread/attachments onto live im messages by id', () => {
    const im = imMessagesToTeam([
      { id: 'a', channelId: 'c', senderId: 'u', text: 'hi', createdAt: 10 },
      { id: 'b', channelId: 'c', senderId: 'u2', text: 'there', createdAt: 20 },
    ])
    const local = [
      {
        id: 'b',
        channelId: 'c',
        seq: 2,
        senderId: 'u2',
        text: 'stale body ignored',
        createdAt: 20,
        replyToId: 'a',
        threadId: 'a',
        attachments: [{ id: 'att-1', name: 'spec.pdf', status: 'unavailable' as const }],
      },
    ]
    const merged = mergeLocalEnrichments(im, local)
    expect(merged[0]).toEqual(im[0])
    expect(merged[1]).toMatchObject({
      id: 'b',
      text: 'there',
      replyToId: 'a',
      threadId: 'a',
      attachments: [{ id: 'att-1', name: 'spec.pdf', status: 'unavailable' }],
    })
  })


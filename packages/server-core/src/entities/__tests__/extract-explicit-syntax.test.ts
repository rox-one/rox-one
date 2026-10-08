import { describe, expect, it } from 'bun:test'
import {
  extractEntityRefsFromText,
  extractLinksFromMessage,
  extractLinksFromTiptapDoc,
  extractRoxDeepLinks,
  wikilinkTargetsToRefs,
} from '../extract.ts'

describe('link extraction policy: explicit syntax only', () => {
  it('bare kind:id in prose creates no links', () => {
    expect(extractEntityRefsFromText('see doc:2 and user:admin')).toEqual([])
    expect(extractLinksFromMessage({ content: 'see doc:2 and user:admin' })).toEqual([])
    expect(extractLinksFromMessage({ content: 'task:t1 blocks note:n2' })).toEqual([])
  })

  it('file URIs and web URLs yield no links', () => {
    expect(extractLinksFromMessage({ content: 'open file:///Users/a/b.txt' })).toEqual([])
    expect(extractLinksFromMessage({ content: 'see https://example.com/doc:2 and mailto:user:admin' })).toEqual([])
    expect(extractRoxDeepLinks('open file:///Users/a/b.txt')).toEqual([])
  })

  it('wikilinks and embeds create links', () => {
    expect(wikilinkTargetsToRefs('[[task:t1|Fix]]')).toEqual([{ to: { kind: 'task', id: 't1' } }])
    expect(wikilinkTargetsToRefs('![[task:t1]]')).toEqual([{ to: { kind: 'task', id: 't1' } }])
    expect(wikilinkTargetsToRefs('[[Alpha]]')).toEqual([{ to: { kind: 'note', id: 'Alpha' } }])
    expect(extractLinksFromMessage({ content: 'see ![[task:t1]] and [[Alpha]]' })).toEqual([
      { to: { kind: 'task', id: 't1' } },
      { to: { kind: 'note', id: 'Alpha' } },
    ])
  })

  it('rox:// deep links create links', () => {
    expect(extractRoxDeepLinks('see rox://goals/goal/g-1')).toEqual([{ to: { kind: 'goal', id: 'g-1' } }])
    expect(extractRoxDeepLinks('see rox://docs/file/f-1')).toEqual([{ to: { kind: 'file', id: 'f-1' } }])
    expect(extractLinksFromMessage({ content: 'open rox://goals/goal/g-1 now' })).toEqual([
      { to: { kind: 'goal', id: 'g-1' } },
    ])
    expect(extractRoxDeepLinks('rox://definitely-not-a-route')).toEqual([])
    expect(extractRoxDeepLinks('rox://action/new-chat')).toEqual([])
  })

  it('structured mention nodes create links', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'mention', attrs: { ref: 'task:t1' } },
        { type: 'mention', attrs: { kind: 'task', id: 't2' } },
        {
          type: 'paragraph',
          attrs: { id: 'blk-1' },
          content: [{ type: 'text', text: 'hi', marks: [{ type: 'mention', attrs: { ref: 'note:n1' } }] }],
        },
      ],
    }
    expect(extractLinksFromTiptapDoc(doc)).toEqual([
      { to: { kind: 'task', id: 't1' } },
      { to: { kind: 'task', id: 't2' } },
      { to: { kind: 'note', id: 'n1' }, blockId: 'blk-1' },
    ])
  })

  it('tiptap text nodes ignore bare refs but keep explicit syntax', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'blk-1' },
          content: [
            { type: 'text', text: 'bare doc:2 and user:admin' },
            { type: 'text', text: 'explicit [[task:t1]] and rox://goals/goal/g-1' },
          ],
        },
      ],
    }
    expect(extractLinksFromTiptapDoc(doc)).toEqual([
      { to: { kind: 'task', id: 't1' }, blockId: 'blk-1' },
      { to: { kind: 'goal', id: 'g-1' }, blockId: 'blk-1' },
    ])
  })
})

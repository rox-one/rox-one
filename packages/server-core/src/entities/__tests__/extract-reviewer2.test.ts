import { describe, expect, it } from 'bun:test'
import {
  extractLinksFromTiptapDoc,
  extractRoxDeepLinks,
  wikilinkTargetsToRefs,
} from '../extract.ts'

describe('reviewer round 2 — fragments, decoding, plain-colon titles', () => {
  it('unexpected-fragment re-parses the part before #', () => {
    expect(wikilinkTargetsToRefs('[[note:abc#Heading]]')).toEqual([{ to: { kind: 'note', id: 'abc' } }])
    expect(wikilinkTargetsToRefs('[[task:42#section]]')).toEqual([{ to: { kind: 'task', id: '42' } }])
  })

  it('TipTap wikilink marks link headings to the entity', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'blk-1' },
          content: [{ type: 'text', text: 'x', marks: [{ type: 'wikilink', attrs: { target: 'note:abc#Heading' } }] }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'y', marks: [{ type: 'mention', attrs: { target: 'task:42#section' } }] }],
        },
      ],
    }
    expect(extractLinksFromTiptapDoc(doc)).toEqual([
      { to: { kind: 'note', id: 'abc' }, blockId: 'blk-1' },
      { to: { kind: 'task', id: '42' } },
    ])
  })

  it('percent-encoded rox:// wiki fragments decode (Cyrillic backlinks)', () => {
    expect(extractRoxDeepLinks('see rox://docs/wiki/w1/%D0%9F%D0%BB%D0%B0%D0%BD')).toEqual([
      { to: { kind: 'wiki-space', id: 'w1', fragment: 'План' } },
    ])
  })

  it('legacy rox:// shapes keep linking through the shared grammar', () => {
    expect(extractRoxDeepLinks('see rox://notes/note/n-1')).toEqual([{ to: { kind: 'note', id: 'n-1' } }])
    expect(extractRoxDeepLinks('see rox://tasks/task/t-1')).toEqual([{ to: { kind: 'task', id: 't-1' } }])
  })

  it('plain colon titles survive without silent trimming', () => {
    expect(wikilinkTargetsToRefs('[[Встреча: итоги]]')).toEqual([{ to: { kind: 'note', id: 'Встреча: итоги' } }])
    expect(wikilinkTargetsToRefs('[[doc: plan]]')).toEqual([{ to: { kind: 'note', id: 'doc: plan' } }])
  })
})

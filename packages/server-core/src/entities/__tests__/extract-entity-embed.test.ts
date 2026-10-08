/**
 * W1-08 (#1505): the TipTap JSON walk records `entityEmbed` nodes as
 * `embeds` links, and the text/node paths share the core classifier.
 */
import { describe, expect, it } from 'bun:test'
import { extractLinksFromTiptapDoc, parseWikilinkTarget, wikilinkTargetsToRefs } from '../extract.ts'

describe('entityEmbed in the TipTap JSON walk', () => {
  it('an entityEmbed node produces an embeds link', () => {
    const links = extractLinksFromTiptapDoc({
      type: 'doc',
      content: [{ type: 'entityEmbed', attrs: { ref: 'goal:q4', label: 'Q4', source: '![[objective:q4|Q4]]' } }],
    })
    expect(links).toEqual([{ to: { kind: 'goal', id: 'q4' }, relation: 'embeds' }])
  })

  it('a mention and an embed of the same entity both survive', () => {
    const links = extractLinksFromTiptapDoc({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'mention', attrs: { ref: 'task:1', label: '' } }] },
        { type: 'entityEmbed', attrs: { ref: 'task:1' } },
      ],
    })
    expect(links).toEqual([{ to: { kind: 'task', id: '1' } }, { to: { kind: 'task', id: '1' }, relation: 'embeds' }])
  })

  it('empty or non-entity embed refs create no link (negative)', () => {
    expect(extractLinksFromTiptapDoc({ type: 'doc', content: [{ type: 'entityEmbed', attrs: { ref: '' } }] })).toEqual([])
    expect(extractLinksFromTiptapDoc({ type: 'doc', content: [{ type: 'entityEmbed', attrs: {} }] })).toEqual([])
  })
})

describe('parseWikilinkTarget (delegates to the core classifier)', () => {
  it('keeps the approved #1499 behaviour', () => {
    expect(parseWikilinkTarget('note: итоги')).toEqual({ kind: 'note', id: 'note: итоги' })
    expect(parseWikilinkTarget('Встреча: итоги')).toEqual({ kind: 'note', id: 'Встреча: итоги' })
    expect(parseWikilinkTarget('doc:2')).toEqual({ kind: 'note', id: '2' })
    expect(parseWikilinkTarget('note:abc#Heading')).toEqual({ kind: 'note', id: 'abc' })
    expect(wikilinkTargetsToRefs('[[note: итоги]]').map((l) => l.to)).toEqual([{ kind: 'note', id: 'note: итоги' }])
  })
})

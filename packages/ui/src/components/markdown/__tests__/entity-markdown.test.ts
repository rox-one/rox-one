/**
 * W1-08 (#1505) — entity mention/embed Markdown helpers + markdown-it rules.
 */
import { describe, expect, it } from 'bun:test'
import MarkdownIt from 'markdown-it'
import {
  canonicalEntityTarget,
  installEntityMarkdownRules,
  matchEntityEmbed,
  matchEntityMention,
  sanitizeMentionLabel,
  serializeEntityEmbed,
  serializeEntityMention,
} from '../entity-markdown'

describe('serialisation', () => {
  it('mention → [[kind:id|label]] or [[kind:id]]; embed → ![[kind:id]]', () => {
    expect(serializeEntityMention('task:42', 'Fix bug')).toBe('[[task:42|Fix bug]]')
    expect(serializeEntityMention('task:42')).toBe('[[task:42]]')
    expect(serializeEntityMention('task:42', '   ')).toBe('[[task:42]]')
    expect(serializeEntityEmbed('goal:q4')).toBe('![[goal:q4]]')
  })

  it('canonicalises refs and sanitises labels that would break the syntax', () => {
    expect(canonicalEntityTarget(' task:42 ')).toBe('task:42')
    expect(sanitizeMentionLabel('a]]b\nc')).toBe('a b c')
    const serialized = serializeEntityMention('task:42', 'x]] [[evil')
    expect(serialized).toBe('[[task:42|x [[evil]]')
    expect(matchEntityMention(serialized)).toMatchObject({ ref: 'task:42' })
  })

  it('returns null for non-refs (negative)', () => {
    expect(canonicalEntityTarget('My note')).toBeNull()
    expect(canonicalEntityTarget('nope:1')).toBeNull()
    expect(canonicalEntityTarget('')).toBeNull()
    expect(matchEntityMention('[[My note]]')).toBeNull()
    expect(matchEntityMention('[[nope:1|x]]')).toBeNull()
    expect(matchEntityMention('task:42')).toBeNull()
    expect(matchEntityEmbed('![[My note]]')).toBeNull()
  })

  it('matches at the start of the source only', () => {
    expect(matchEntityMention('[[task:42|A]] rest')).toEqual({ raw: '[[task:42|A]]', ref: 'task:42', label: 'A' })
    expect(matchEntityMention('x [[task:42]]')).toBeNull()
    expect(matchEntityEmbed('![[goal:q4]]')).toEqual({ raw: '![[goal:q4]]', ref: 'goal:q4', label: null })
  })
})

describe('markdown-it rules (legacy engine)', () => {
  const md = new MarkdownIt()
  installEntityMarkdownRules(md)
  installEntityMarkdownRules(md) // idempotent

  it('renders inline mentions and whole-line embeds', () => {
    const html = md.render('See [[task:42|Fix bug]] now\n\n![[goal:q4]]\n')
    expect(html).toContain('data-entity-mention')
    expect(html).toContain('task:42')
    expect(html).toContain('data-entity-embed')
    expect(html).toContain('goal:q4')
  })

  it('leaves plain wikilinks, bare refs and invalid refs alone (negative)', () => {
    const html = md.render('[[My note]] task:42 [[nope:1|x]]')
    expect(html).not.toContain('data-entity-mention')
    expect(html).not.toContain('data-entity-embed')
  })

  it('an embed inside a sentence is not a block embed', () => {
    expect(md.render('text ![[goal:q4]] more')).not.toContain('data-entity-embed')
  })
})

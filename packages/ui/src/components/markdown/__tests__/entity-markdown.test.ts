/**
 * W1-08 (#1505) — entity mention/embed Markdown helpers + markdown-it rules.
 */
import { describe, expect, it } from 'bun:test'
import MarkdownIt from 'markdown-it'
import { Lexer } from 'marked'
import {
  canonicalEntityTarget,
  endsWithUnescapedBang,
  entityEmbedBlockStart,
  escapeTrailingBang,
  installEntityMarkdownRules,
  isMarkedRootTokenList,
  isWikilinkSafeRefLiteral,
  matchEntityEmbedBlock,
  matchEntityEmbedLine,
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

describe('review fixes (#1505 fix1)', () => {
  it('serialises the original source verbatim while it still matches ref/label', () => {
    for (const raw of ['[[doc:2]]', '[[meeting:x]]', '[[user:a]]', '[[heading:Intro]]', '[[note:100%]]', '[[task:1|  Spaced   label ]]', '[[ task:1 ]]']) {
      const m = matchEntityMention(raw)!
      expect(m.raw).toBe(raw)
      expect(serializeEntityMention(m.ref, m.label, m.raw)).toBe(raw)
    }
    const embed = matchEntityEmbed('![[objective:q4| Plan ]]')!
    expect(serializeEntityEmbed(embed.ref, embed.label, embed.raw)).toBe('![[objective:q4| Plan ]]')
  })

  it('falls back to the canonical form when the node changed or has no source', () => {
    expect(serializeEntityMention('note:2', null, '[[doc:2]]')).toBe('[[doc:2]]')
    expect(serializeEntityMention('note:3', null, '[[doc:2]]')).toBe('[[note:3]]')
    expect(serializeEntityMention('note:2', 'New', '[[doc:2|Old]]')).toBe('[[note:2|New]]')
    expect(serializeEntityMention('note:100%')).toBe('[[note:100%25]]')
    expect(serializeEntityMention('task:1', null, 'garbage')).toBe('[[task:1]]')
  })

  it('embeds keep their |label', () => {
    expect(matchEntityEmbed('![[task:1|Release plan]]')).toEqual({ raw: '![[task:1|Release plan]]', ref: 'task:1', label: 'Release plan' })
    expect(serializeEntityEmbed('task:1', 'Release plan')).toBe('![[task:1|Release plan]]')
    const html = new MarkdownIt()
    installEntityMarkdownRules(html)
    expect(html.render('![[task:1|Release plan]]\n')).toContain('data-label="Release plan"')
  })

  it('note titles with a colon are not entity refs (shared classifier)', () => {
    expect(matchEntityMention('[[note: итоги]]')).toBeNull()
    expect(matchEntityMention('[[task: что-то]]')).toBeNull()
    expect(matchEntityMention('[[Встреча: итоги]]')).toBeNull()
    expect(matchEntityEmbed('![[note: итоги]]')).toBeNull()
    expect(canonicalEntityTarget('note: итоги')).toBeNull()
    expect(matchEntityMention('[[note:abc#Heading]]')).toMatchObject({ ref: 'note:abc' })
  })

  it('official-engine block start returns line-start positions only', () => {
    // marked passes `src.slice(1)`: index 0 always follows a lost paragraph character.
    expect(entityEmbedBlockStart('![[task:1]]')).toBe(-1)
    expect(entityEmbedBlockStart('See ![[task:1]]')).toBe(-1)
    expect(entityEmbedBlockStart('Para\n![[task:1]]')).toBe(-1)
    expect(entityEmbedBlockStart('Para\n\n![[task:1]]')).toBe(6)
    expect(entityEmbedBlockStart('a ![[x:1]]\n\n  ![[task:1]]')).toBe(14)
  })

  it('whole-line embed matching ignores trailing space but not indented code', () => {
    expect(matchEntityEmbedLine('![[task:1]]  ')).toMatchObject({ ref: 'task:1' })
    expect(matchEntityEmbedLine('    ![[task:1]]')).toBeNull()
    expect(matchEntityEmbedLine('![[task:1]] tail')).toBeNull()
  })

  it('legacy: an embed line does not interrupt the paragraph above it', () => {
    const md = new MarkdownIt()
    installEntityMarkdownRules(md)
    expect(md.render('Para\n![[task:1]]\n')).not.toContain('data-entity-embed')
    expect(md.render('Para\n\n![[task:1]]\n')).toContain('data-entity-embed')
    expect(md.render('[[doc:2]]')).toContain('data-source="[[doc:2]]"')
  })
})

describe('review fixes (#1505 fix2)', () => {
  it('refs whose literal cannot be written inside [[…]] have no canonical target', () => {
    for (const target of ['project:a|b', 'file:x]y', 'file:a[[b', 'task:a\nb', 'task:a\rb']) {
      expect(canonicalEntityTarget(target)).toBeNull()
    }
    expect(isWikilinkSafeRefLiteral('project:a|b')).toBe(false)
    expect(isWikilinkSafeRefLiteral('')).toBe(false)
    expect(isWikilinkSafeRefLiteral('file:x[y')).toBe(true)
    expect(canonicalEntityTarget('file:x[y')).toBe('file:x[y')
    // `[[` inside a target is not a mention either (stays text).
    expect(matchEntityMention('[[task:a[[b]]')).toBeNull()
  })

  it('markdown-it: embed lines inside list items and blockquotes are not block embeds', () => {
    const md = new MarkdownIt()
    installEntityMarkdownRules(md)
    for (const src of ['- ![[goal:q4]]\n', '- [ ] ![[goal:q4]]\n', '1. ![[goal:q4]]\n', '> ![[goal:q4]]\n', '- a\n\n  ![[goal:q4]]\n']) {
      expect(md.render(src)).not.toContain('data-entity-embed')
    }
    // Top level still works, including right after a list or a setext-like line.
    expect(md.render('- a\n\n![[goal:q4]]\n')).toContain('data-entity-embed')
    expect(md.render('A\n\n![[goal:q4]]\n\n- b\n')).toContain('data-entity-embed')
  })

  it('marked: only the root token list counts as top level', () => {
    const lexer = new Lexer()
    expect(isMarkedRootTokenList((lexer as unknown as { tokens: unknown }).tokens)).toBe(true)
    expect(isMarkedRootTokenList([])).toBe(false)
    expect(isMarkedRootTokenList(undefined)).toBe(false)
  })
})

describe('review fixes (#1505 fix3)', () => {
  it('a block embed needs a blank line (or the end) after it too', () => {
    const md = new MarkdownIt()
    installEntityMarkdownRules(md)
    expect(md.render('![[task:1]]\nPara\n')).not.toContain('data-entity-embed')
    expect(md.render('A\n\n![[task:1]]\nPara\n')).not.toContain('data-entity-embed')
    expect(md.render('![[task:1]]\n\nPara\n')).toContain('data-entity-embed')
    expect(md.render('![[task:1]]\n   \nPara\n')).toContain('data-entity-embed')
    expect(md.render('![[task:1]]')).toContain('data-entity-embed')
  })

  it('official-engine start/tokenize mirror the next-line check', () => {
    expect(entityEmbedBlockStart('![[task:1]]\nPara')).toBe(-1)
    expect(entityEmbedBlockStart('A\n\n![[task:1]]\nPara')).toBe(-1)
    expect(entityEmbedBlockStart('A\n\n![[task:1]]\n\nB')).toBe(3)
    expect(entityEmbedBlockStart('A\n\n![[task:1]]')).toBe(3)
    // First line of `src` is a truncated paragraph line: never blank, never a line start.
    expect(entityEmbedBlockStart('\n![[task:1]]')).toBe(-1) // paragraph `x\n![[task:1]]`
    expect(entityEmbedBlockStart('\n\n![[task:1]]')).toBe(2) // paragraph `x` + blank line
    expect(matchEntityEmbedBlock('![[task:1]]\nPara')).toBeNull()
    expect(matchEntityEmbedBlock('![[task:1]]\n\nPara')).toEqual({ match: { raw: '![[task:1]]', ref: 'task:1', label: null }, raw: '![[task:1]]\n' })
    expect(matchEntityEmbedBlock('![[task:1]]')?.raw).toBe('![[task:1]]')
  })

  it('a trailing `!` is escaped only when it is unescaped', () => {
    expect(endsWithUnescapedBang('Done!')).toBe(true)
    expect(endsWithUnescapedBang('!')).toBe(true)
    expect(endsWithUnescapedBang('a\\\\!')).toBe(true) // `a\\!`: escaped backslash, real `!`
    expect(endsWithUnescapedBang('a\\!')).toBe(false)
    expect(endsWithUnescapedBang('Done! ')).toBe(false)
    expect(endsWithUnescapedBang('')).toBe(false)
    // (src, end) form used by the parsers: looks only at src[end - 1] and the backslashes before it.
    expect(endsWithUnescapedBang('Done![[task:1]]', 5)).toBe(true)
    expect(endsWithUnescapedBang('Done\\![[task:1]]', 6)).toBe(false)
    expect(endsWithUnescapedBang('a\\\\![[x]]', 4)).toBe(true)
    expect(endsWithUnescapedBang('Done[[task:1]]', 4)).toBe(false)
    expect(endsWithUnescapedBang('![[task:1]]', 0)).toBe(false)
    expect(endsWithUnescapedBang(`${'\\'.repeat(100001)}!`)).toBe(false)
    expect(endsWithUnescapedBang(`${'\\'.repeat(100000)}!`)).toBe(true)
    expect(escapeTrailingBang('Done!')).toBe('Done\\!')
    expect(escapeTrailingBang('Done\\!')).toBe('Done\\!')
    expect(escapeTrailingBang('Done. ')).toBe('Done. ')
  })

  it('markdown-it: `\\![[…]]` is a literal `!` + mention; `![[…]]` mid-line stays text', () => {
    const md = new MarkdownIt()
    installEntityMarkdownRules(md)
    const escaped = md.render('Done\\![[task:1]]\n')
    expect(escaped).toContain('Done!<span data-entity-mention="task:1"')
    expect(md.render('\\![[task:1]]\n')).toContain('<p>!<span data-entity-mention="task:1"')
    expect(md.render('\\![[task:1]]\n')).not.toContain('data-entity-embed')
    expect(md.render('Done![[task:1]]\n')).not.toContain('data-entity-mention')
    expect(md.render('a\\\\![[task:1]]\n')).not.toContain('data-entity-mention')
  })

  it('marked: the escape token before `[[` does not block the mention start', () => {
    const tokens = new Lexer().lex('Done\\![[task:1]]')
    const inline = (tokens[0] as { tokens?: Array<{ type: string; raw: string }> }).tokens ?? []
    expect(inline.map((t) => t.type)).toContain('escape')
    expect(endsWithUnescapedBang(inline.find((t) => t.type === 'escape')!.raw)).toBe(false)
  })

  it('markdown-it: the mention rule never consumes in silent mode, so a mention inside link text keeps the link (#1505 fix6)', () => {
    const md = new MarkdownIt()
    installEntityMarkdownRules(md)
    const types = (src: string) => (md.parseInline(src, {})[0]?.children ?? []).map((t) => t.type)
    expect(types('[x [[task:1]] y](http://z)')).toEqual(['link_open', 'text', 'rox_entity_mention', 'text', 'link_close'])
    expect(types('[[[task:1]]](url)')).toEqual(['link_open', 'rox_entity_mention', 'link_close'])
    expect(types('a [[task:1]] b')).toEqual(['text', 'rox_entity_mention', 'text'])
    expect(types('[[task:1]](url)')).toEqual(['rox_entity_mention', 'text'])
  })
})

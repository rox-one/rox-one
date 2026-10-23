import { describe, expect, it } from 'bun:test'
import {
  canonicalizeRoxBlockKind,
  createRoxBlockContent,
  defaultRoxBlockToggle,
  formatRoxBlockMarker,
  parseRoxBlockMarker,
  ROX_BLOCK_KIND_ALIASES,
  ROX_BLOCK_KINDS,
} from '../rox-block-syntax'

describe('Rox callout kinds', () => {
  it('accepts exactly eight canonical kinds', () => {
    expect(ROX_BLOCK_KINDS).toHaveLength(8)
  })

  it.each(Object.entries(ROX_BLOCK_KIND_ALIASES))(
    'alias %s → %s',
    (alias, canonical) => {
      expect(canonicalizeRoxBlockKind(alias)).toBe(canonical)
      const marker = parseRoxBlockMarker(`[!${alias}]+ Title`)
      expect(marker?.kind).toBe(canonical)
      expect(formatRoxBlockMarker(marker!)).toBe(`[!${canonical}]+ Title`)
    },
  )

  it('requires an explicit +/- toggle on every kind', () => {
    for (const kind of ROX_BLOCK_KINDS) {
      expect(parseRoxBlockMarker(`[!${kind}] Title`)).toBeNull()
      expect(parseRoxBlockMarker(`[!${kind}]+ Title`)?.toggle).toBe('+')
      expect(parseRoxBlockMarker(`[!${kind}]- Title`)?.toggle).toBe('-')
    }
  })

  it('slash defaults: spoiler collapsed, others expanded', () => {
    for (const kind of ROX_BLOCK_KINDS) {
      const content = createRoxBlockContent(kind, 'Label')
      const text = content.content?.[0]?.content?.[0]?.text as string
      expect(text).toBe(`[!${kind}]${defaultRoxBlockToggle(kind)} Label`)
    }
  })
})

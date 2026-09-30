import { expect, test } from 'bun:test'
import matter from 'gray-matter'
import { previewPropertyDictionary } from '../../packages/core/src/docs/property-dictionary.ts'

test('scalar property edit preserves BOM, comments, unknown fields, line endings and body exactly', () => {
  const text = '\uFEFF---\r\ntitle: \'Old\' # keep\r\ncustom: !unknown opaque\r\n---\r\n\r\n# Unicode 東京\r\n\r\n  prose  \r\n'
  const before = { title: 'Old', custom: 'opaque' }
  const result = previewPropertyDictionary(text, before, { ...before, title: 'New' })
  expect(result.requiresReview).toBe(false)
  expect(result.content).toBe(text.replace("title: 'Old'", "title: 'New'"))
  expect(result.digest).toMatch(/^sha256:/)
})
test('new/list/deleted properties require exact review and never trim or normalize body', () => {
  const body = '\r\n\r\n  prose 東京  \r\n- item\r\n'
  const content = '\uFEFF---\r\ntitle: Old # comment\r\n---\r\n' + body
  const result = previewPropertyDictionary(content, { title: 'Old' }, { title: 'Old', tags: ['work'] })
  expect(result.requiresReview).toBe(true)
  expect(result.before).toContain('# comment')
  expect(result.after).toContain('tags:')
  expect(result.content.endsWith(body)).toBe(true)
  expect(result.content.startsWith('\uFEFF')).toBe(true)
  expect(previewPropertyDictionary(content, { title: 'Old' }, {}).requiresReview).toBe(true)
})
test('no-op is byte-identical and malformed frontmatter is rejected', () => {
  const content = '---\ntitle: Old # keep\n---\n\ntext\n'
  expect(previewPropertyDictionary(content, { title: 'Old' }, { title: 'Old' }).content).toBe(content)
  expect(() => previewPropertyDictionary('---\nno closing', {}, {})).toThrow('Unsupported')
})

test('real gray-matter unknown-tag fallback cannot turn an existing scalar edit into header conversion', () => {
  const content = '\uFEFF---\r\n# keep comment\r\ntitle: \'Old\' # selected comment\r\ncustom: !unknown opaque\r\nprivate: { nested: yes }\r\n---\r\n\r\nbody 東京  \r\n'
  let previous: Record<string, unknown> = {}
  let legacyReadFailed = false
  try { previous = matter(content).data } catch { legacyReadFailed = true }
  expect(legacyReadFailed).toBe(true)
  expect(previous).toEqual({})
  const preview = previewPropertyDictionary(content, previous, { title: 'New' })
  expect(preview.requiresReview).toBe(false)
  expect(preview.content).toBe(content.replace("title: 'Old'", "title: 'New'"))
  expect(preview.after).toContain('custom: !unknown opaque')
  expect(previewPropertyDictionary(content, previous, { title: 'Old' }).content).toBe(content)
})

test('authoritative scalar eligibility does not require field membership in a supplied dictionary', () => {
  const content = '---\ntitle: Old # keep\ncount: 0\n---\nbody\n'
  const preview = previewPropertyDictionary(content, { count: 0 }, { title: 'New', count: -0 })
  expect(preview.requiresReview).toBe(false)
  expect(preview.content).toBe('---\ntitle: "New" # keep\ncount: -0\n---\nbody\n')
  expect(previewPropertyDictionary(content, { missingStaleKey: 'ignored' }, {}).content).toBe(content)
})

test('unchanged legacy timestamps survive dictionary transport and another scalar edit without normalization', () => {
  const content = '---\ntitle: Old # keep\ndate: 2026-09-30 # portable date-only value\n---\nbody\n'
  const previous = matter(content).data
  expect(previous.date).toBeInstanceOf(Date)
  const next = JSON.parse(JSON.stringify({ ...previous, title: 'New' }))
  const preview = previewPropertyDictionary(content, previous, next)
  expect(preview.requiresReview).toBe(false)
  expect(preview.content).toBe(content.replace('title: Old', 'title: "New"'))
})

test('closed malformed, duplicate or complex-key YAML is readonly even with a reviewable dictionary', () => {
  for (const content of [
    '---\nunknown: [broken\n---\nbody\n',
    '---\ntitle: Old\ntitle: Duplicate\n---\nbody\n',
    '---\n? [complex, key]\n: value\n---\nbody\n',
    '---\n- sequence header\n---\nbody\n',
  ]) {
    expect(() => previewPropertyDictionary(content, {}, { title: 'New' })).toThrow('Unsupported source')
    expect(() => previewPropertyDictionary(content, {}, {})).toThrow('Unsupported source')
  }
})

test('unknown tags and shared aliases remain intact and cannot be discarded by normal dictionary conversion', () => {
  const unknown = '---\ntitle: Old # keep\ncustom: !unknown opaque\n---\nbody\n'
  expect(() => previewPropertyDictionary(unknown, { title: 'Old' }, { title: 'Old', tags: ['new'] })).toThrow('Unsupported source property conversion')
  expect(() => previewPropertyDictionary(unknown, { title: 'Old' }, {})).toThrow('Unsupported source property conversion')
  expect(() => previewPropertyDictionary(unknown, { custom: 'opaque' }, { custom: 'changed' })).toThrow('Unsupported source property conversion')
  const shared = '---\ntitle: Old # keep\nshared: &anchor { x: 1 }\nref: *anchor\n---\nbody\n'
  expect(previewPropertyDictionary(shared, {}, { title: 'New' }).content).toBe(shared.replace('title: Old', 'title: "New"'))
  expect(() => previewPropertyDictionary(shared, {}, { added: ['value'] })).toThrow('Unsupported source property conversion')
})

test('normalizable map/sequence/block-string changes still expose an exact reviewed conversion', () => {
  const content = '---\ntitle: Old\ntags: [one, two]\nnested: { number: 1 }\nlong: |\n  old text\n---\n\nbody  \n'
  const previous = matter(content).data
  const preview = previewPropertyDictionary(content, previous, { ...previous, tags: ['three'], nested: { number: 2 } })
  expect(preview.requiresReview).toBe(true)
  expect(preview.before).toBe(content.slice(0, content.indexOf('\n\nbody') + 1))
  expect(preview.after).toContain('three')
  expect(preview.content.endsWith('\nbody  \n')).toBe(true)
  expect(previewPropertyDictionary(content, previous, previous).content).toBe(content)
})

test('dictionary values and source text cannot silently lose invalid UTF16 characters', () => {
  const content = '---\ntitle: Old\n---\nbody\n'
  expect(() => previewPropertyDictionary(content, {}, { title: '\ud800' })).toThrow('Invalid properties')
  expect(() => previewPropertyDictionary(`${content}\ud800`, {}, {})).toThrow('Unsupported source')
})

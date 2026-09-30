import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { parseDocument } from 'yaml'
import {
  applyRawSpanPatches, previewRawSpanPatches, rawSpanPreviewDigest, rebaseRawSpanPreview,
  retainedSourceHash, retainedText, retainSource, utf8Bytes, type RawSpanPreview,
} from '../../packages/core/src/docs/retained-source.ts'
import {
  applyPropertyPatch, previewPropertyPatch, projectFrontmatter, rebasePropertyPatch,
  type PropertyPatchPreview, type PropertyValue,
} from '../../packages/core/src/docs/frontmatter-patches.ts'

function propertyPreview(text: string, path: string[], value: PropertyValue): PropertyPatchPreview {
  const preview = previewPropertyPatch(retainSource(text), path, value)
  if ('status' in preview) throw new Error(`Preview failed: ${preview.code}`)
  return preview
}
function rawPreview(text: string, patches: Parameters<typeof previewRawSpanPatches>[1]): RawSpanPreview {
  const preview = previewRawSpanPatches(retainSource(text), patches)
  if ('status' in preview) throw new Error(`Preview failed: ${preview.code}`)
  return preview
}
/** Independent byte preservation oracle, including shifts caused by replacement lengths. */
function expectUneditedBytes(before: Uint8Array, after: Uint8Array, preview: RawSpanPreview) {
  let oldOffset = 0, newOffset = 0
  for (const patch of preview.patches) {
    const count = patch.start - oldOffset
    expect(after.slice(newOffset, newOffset + count)).toEqual(before.slice(oldOffset, patch.start))
    newOffset += count + utf8Bytes(patch.replacement).length
    oldOffset = patch.end
  }
  expect(after.slice(newOffset)).toEqual(before.slice(oldOffset))
}

describe('LSX-WP-005 retained UTF-8 source and raw spans', () => {
  test('SHA256 agrees with an independent native implementation, including BOM and binary inputs', () => {
    for (const input of ['', 'abc', '\uFEFFЛиссабон 🐈\r\n', 'a'.repeat(1000), new Uint8Array([0, 255, 13, 10])]) {
      const bytes = typeof input === 'string' ? utf8Bytes(input) : input
      expect(retainedSourceHash(input)).toBe(`sha256:${createHash('sha256').update(bytes).digest('hex')}`)
    }
  })

  test('retains BOM, mixed EOL, terminal newline and byte-based Unicode ranges', () => {
    const text = '\uFEFF---\r\nclé: café\n---\rbody 🐈\r\nlast'
    const source = retainSource(text)
    expect(source.text).toBe(text)
    expect(source.bytes).toEqual(utf8Bytes(text))
    expect(source.lines.map(line => line.eol)).toEqual(['\r\n', '\n', '\r', '\r\n', ''])
    expect(source.frontmatter?.contentStart).toBe(utf8Bytes('\uFEFF---\r\n').length)
    for (const line of source.lines) expect(retainedText(source, line)).toBe(line.text + line.eol)
    expect(() => retainedText(source, { start: -1, end: 2 })).toThrow(RangeError)
    expect(() => retainedText(source, { start: 0.5, end: 2 })).toThrow(RangeError)
  })

  test('explicit spans preserve all bytes outside edits; no-op keeps the exact hash', () => {
    const text = '\uFEFF# café\r\n\r\nbody 🐈\ntrailing\r'
    const start = utf8Bytes('\uFEFF# ').length, end = start + utf8Bytes('café').length
    const preview = rawPreview(text, [{ start, end, expected: 'café', replacement: 'Кофе ☕' }])
    const result = applyRawSpanPatches(retainSource(text), preview)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.text).toBe('\uFEFF# Кофе ☕\r\n\r\nbody 🐈\ntrailing\r')
    expectUneditedBytes(utf8Bytes(text), result.bytes, preview)
    const noOp = rawPreview(text, [{ start, end, expected: 'café', replacement: 'café' }])
    expect(noOp.patches).toEqual([])
    expect(applyRawSpanPatches(retainSource(text), noOp)).toMatchObject({ noOp: true, sourceHash: retainedSourceHash(text), bytes: utf8Bytes(text) })
  })

  test('invalid UTF-8, half a Unicode code point, unsafe ranges, overlap and stale expected text fail closed', () => {
    expect(previewRawSpanPatches(retainSource(new Uint8Array([0xc3, 0x28])), [])).toEqual({ status: 'error', code: 'unknownFormat' })
    const source = retainSource('é🐈x')
    for (const [start, end] of [[-1, 0], [0.5, 2], [0, 50], [2, 1], [1, 1], [3, 6], [0, Number.MAX_SAFE_INTEGER + 1]]) {
      expect(previewRawSpanPatches(source, [{ start: start!, end: end!, expected: '', replacement: 'z' }])).toMatchObject({ status: 'error' })
    }
    expect(previewRawSpanPatches(source, [{ start: 0, end: 2, expected: 'é', replacement: '\ud800' }])).toEqual({ status: 'error', code: 'validation' })
    expect(previewRawSpanPatches(source, [{ start: 0, end: 2, expected: 'wrong', replacement: 'z' }])).toEqual({ status: 'error', code: 'conflict' })
    expect(previewRawSpanPatches(source, [
      { start: 0, end: 2, expected: 'é', replacement: 'z' }, { start: 0, end: 0, expected: '', replacement: 'y' },
    ])).toEqual({ status: 'error', code: 'validation' })
    expect(previewRawSpanPatches(source, [null] as never)).toEqual({ status: 'error', code: 'validation' })
  })

  test('apply rechecks digest, source SHA and byte bounds even with a recomputed digest', () => {
    const text = 'old body'
    const preview = rawPreview(text, [{ start: 0, end: 3, expected: 'old', replacement: 'new' }])
    expect(applyRawSpanPatches(retainSource(`${text}\nexternal`), preview)).toEqual({ status: 'error', code: 'conflict' })
    expect(applyRawSpanPatches(retainSource(text), { ...preview, patches: [{ ...preview.patches[0]!, replacement: 'hijacked' }] }))
      .toEqual({ status: 'error', code: 'validation' })
    const unsafe = [{ start: -1, end: 3, expected: 'old', replacement: 'new' }]
    expect(applyRawSpanPatches(retainSource(text), { ...preview, patches: unsafe, digest: rawSpanPreviewDigest(preview.expectedSourceHash, unsafe) }))
      .toEqual({ status: 'error', code: 'validation' })
    const corrupted = retainSource(text)
    corrupted.bytes[0] = 120
    expect(previewRawSpanPatches(corrupted, [])).toEqual({ status: 'error', code: 'conflict' })
    expect(applyRawSpanPatches(corrupted, preview)).toEqual({ status: 'error', code: 'conflict' })
  })

  test('explicit conservative rebase permits an outside splice and conflicts on selected bytes or insertion point', () => {
    const base = retainSource('prefix target suffix')
    const preview = rawPreview(base.text, [{ start: 7, end: 13, expected: 'target', replacement: 'chosen' }])
    const current = retainSource('longer prefix target suffix')
    const rebased = rebaseRawSpanPreview(base, current, preview)
    expect('status' in rebased).toBe(false)
    if (!('status' in rebased)) expect(applyRawSpanPatches(current, rebased)).toMatchObject({ text: 'longer prefix chosen suffix' })
    expect(rebaseRawSpanPreview(base, retainSource('prefix changed suffix'), preview)).toEqual({ status: 'error', code: 'conflict' })
    const insert = rawPreview(base.text, [{ start: 7, end: 7, expected: '', replacement: 'our ' }])
    expect(rebaseRawSpanPreview(base, retainSource('prefix external target suffix'), insert)).toEqual({ status: 'error', code: 'conflict' })
  })
})

describe('LSX-WP-005 frontmatter property patches', () => {
  test('only the selected nested scalar changes; unknown tags, anchors, comments and block scalars survive', () => {
    const text = '\uFEFF---\r\n# first comment\r\ntitle: \'Лиссабон\' # selected comment\r\nunknown: !private { keep: yes }\r\nshared: &a { x: 1 }\r\nref: *a\r\nlong: |+\r\n  keep this\r\n  exactly\r\nnested: { price: 12.5, hidden: "untouched" } # flow\r\n---\r\n\r\n# Body\r\n- item ^abc\r\n'
    const source = retainSource(text), preview = propertyPreview(text, ['nested', 'price'], 45)
    expect(preview.patches).toHaveLength(1)
    expect(preview.lossReport).toEqual({ lostBytes: 0, unsupported: [] })
    const result = applyPropertyPatch(source, preview)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.text).toBe(text.replace('price: 12.5', 'price: 45'))
    expectUneditedBytes(source.bytes, result.bytes, preview)
    const readback = projectFrontmatter(retainSource(result.bytes))
    expect(readback.status).toBe('ok')
    if (readback.status !== 'ok') return
    expect(readback.properties.find(binding => binding.keyPath.join('.') === 'nested.price')?.value).toBe(45)
    expect(readback.properties.find(binding => binding.keyPath.join('.') === 'shared.x')?.readOnly).toBe('sharedAnchor')
    expect(readback.properties.find(binding => binding.keyPath.join('.') === 'long')?.readOnly).toBe('unsupportedValue')
    expect(previewPropertyPatch(source, ['shared', 'x'], 2)).toEqual({ status: 'error', code: 'unknownFormat' })
    expect(previewPropertyPatch(source, ['ref'], 'replace')).toEqual({ status: 'error', code: 'unknownFormat' })
  })

  test('typed values read back, quoted style is retained when possible, and typed no-op is byte-identical', () => {
    for (const value of ['café 🐈', "it's literal", 'line\nsecond\rthird', '# true: [x]', '', true, false, 10.25, -0, null]) {
      const text = '---\nvalue: \'old\' # keep comment\n---\nbody\n'
      const preview = propertyPreview(text, ['value'], value)
      const applied = applyPropertyPatch(retainSource(text), preview)
      expect(applied.status).toBe('ok')
      if (applied.status !== 'ok') continue
      const readback = projectFrontmatter(retainSource(applied.bytes))
      expect(readback.status).toBe('ok')
      if (readback.status === 'ok') expect(Object.is(readback.properties[0]?.value, value)).toBe(true)
      expectUneditedBytes(utf8Bytes(text), applied.bytes, preview)
    }
    const text = '---\nvalue: "old" # keep\n---\nbody'
    const noOp = propertyPreview(text, ['value'], 'old')
    expect(applyPropertyPatch(retainSource(text), noOp)).toMatchObject({ noOp: true, bytes: utf8Bytes(text), sourceHash: retainedSourceHash(text) })
    expect(previewPropertyPatch(retainSource(text), ['value'], NaN)).toEqual({ status: 'error', code: 'validation' })
    expect(previewPropertyPatch(retainSource(text), ['value'], '\ud800')).toEqual({ status: 'error', code: 'validation' })
  })

  test('malformed YAML, duplicate/complex keys and unsupported values remain recoverable without empty property overwrite', () => {
    for (const text of [
      '---\nvalue: [broken\n---\nbody', '---\nvalue: 1\nvalue: 2\n---\nbody',
      '---\n? [complex, key]\n: value\n---\nbody', '---\n- sequence\n---\nbody', '---\nvalue: 1\nbody',
    ]) {
      const source = retainSource(text), before = source.bytes.slice()
      expect(projectFrontmatter(source).status).toBe('readOnly')
      expect(previewPropertyPatch(source, ['value'], 5)).toMatchObject({ status: 'error' })
      expect(source.bytes).toEqual(before)
    }
    for (const entry of ['value: !unknown old', 'value: !!future old', 'value: &shared old', 'value: [one, two]', 'value: |\n  multiline']) {
      const source = retainSource(`---\n${entry}\n---\nbody`)
      expect(previewPropertyPatch(source, ['value'], 'new')).toEqual({ status: 'error', code: 'unknownFormat' })
    }
    expect(projectFrontmatter(retainSource('body without YAML'))).toEqual({ status: 'ok', properties: [], warnings: [] })
    expect(previewPropertyPatch(retainSource('body without YAML'), ['value'], 'new')).toEqual({ status: 'error', code: 'unknownFormat' })
  })

  test('purpose digest and expected SHA fence stale or retargeted previews; derived source caches are not authority', () => {
    const text = '---\nleft: 1\nright: 2\n---\nbody'
    const source = retainSource(text), preview = propertyPreview(text, ['left'], 3)
    expect(previewPropertyPatch(source, ['left'], 3, retainedSourceHash('stale'))).toEqual({ status: 'error', code: 'conflict' })
    expect(applyPropertyPatch(retainSource(text.replace('body', 'external')), preview)).toEqual({ status: 'error', code: 'conflict' })
    expect(applyPropertyPatch(source, { ...preview, propertyKeyPath: ['right'] })).toEqual({ status: 'error', code: 'validation' })
    expect(applyPropertyPatch(source, { ...preview, purpose: { kind: 'property', keyPath: ['left'], value: 4 }, propertyValue: 4 }))
      .toEqual({ status: 'error', code: 'validation' })
    const poisoned = retainSource(text)
    poisoned.frontmatter = undefined
    poisoned.text = 'wrong cached body'
    expect(projectFrontmatter(poisoned)).toEqual(projectFrontmatter(source))
  })

  test('explicit property rebase permits multiple unrelated changes but rejects raw target edits, deletion and duplicate keys', () => {
    const text = '---\nleft: 1 # selected\nright: 2\n---\nbody'
    const base = retainSource(text), preview = propertyPreview(text, ['left'], 3)
    const current = retainSource(text.replace('right: 2', 'other: true\nright: 99').replace('body', 'changed body'))
    const rebased = rebasePropertyPatch(base, current, preview)
    expect('status' in rebased).toBe(false)
    if (!('status' in rebased)) {
      expect(rebased.expectedSourceHash).toBe(current.sourceHash)
      expect(rebased.digest).not.toBe(preview.digest)
      expect(applyPropertyPatch(current, rebased)).toMatchObject({ text: current.text.replace('left: 1', 'left: 3') })
    }
    for (const changed of [text.replace('left: 1', 'left: 4'), text.replace('left: 1', 'left: 01'),
      text.replace('left: 1 # selected\n', ''), text.replace('right: 2', 'left: 2')]) {
      expect(rebasePropertyPatch(base, retainSource(changed), preview)).toMatchObject({ status: 'error' })
    }
  })

  test('generated source variants preserve unedited bytes and no-op hashes (fixed reproduction seed 005)', () => {
    const words = ['ASCII', 'café', '東京', 'Лиссабон 🐈', 'e\u0301', '☕']
    for (let seed = 0; seed < 72; seed += 1) {
      const eol = ['\n', '\r\n', '\r'][seed % 3]!
      const bom = seed % 2 ? '\uFEFF' : ''
      const old = words[seed % words.length]!
      const value = words[(seed + 1) % words.length]!
      const text = `${bom}---${eol}# seed ${seed}${eol}field: ${JSON.stringify(old)} # trailing${eol}private: !unknown { x: yes }${eol}---${eol}${old}${eol}| table | value |${eol}`
      const source = retainSource(text), preview = propertyPreview(text, ['field'], value)
      const result = applyPropertyPatch(source, preview)
      expect(result.status).toBe('ok')
      if (result.status !== 'ok') continue
      expectUneditedBytes(source.bytes, result.bytes, preview)
      expect(result.text).toBe(text.replace(`field: ${JSON.stringify(old)}`, `field: ${JSON.stringify(value)}`))
      expect(applyPropertyPatch(source, propertyPreview(text, ['field'], old))).toMatchObject({ noOp: true, sourceHash: source.sourceHash, bytes: source.bytes })
    }
  }, 30_000)

  test('seeded full-YAML-serialization negative control is rejected by the byte preservation oracle', () => {
    const text = '\uFEFF---\r\n# seed 005\r\nfield: "old" # keep\r\nunknown: { b: 2, a: 1 }\r\n---\r\nbody\r\n'
    const preview = propertyPreview(text, ['field'], 'new')
    const yaml = parseDocument('# seed 005\nfield: "old" # keep\nunknown: { b: 2, a: 1 }\n')
    yaml.set('field', 'new')
    const mutant = utf8Bytes(`---\n${yaml.toString()}---\nbody\n`)
    expect(() => expectUneditedBytes(utf8Bytes(text), mutant, preview)).toThrow()
  })
})

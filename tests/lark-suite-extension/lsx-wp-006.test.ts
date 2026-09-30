import { describe, expect, test } from 'bun:test'
import {
  applyMarkerMapping, previewMarkerMapping, projectBlockIdentity, type MarkerMappingPreview,
} from '../../packages/core/src/docs/block-identity.ts'
import { listTreeMarkdown, projectListTree } from '../../packages/core/src/docs/list-tree.ts'
import { rawSpanPreviewDigest, retainedSourceHash, retainedText, retainSource, utf8Bytes, type RawSpanPreview } from '../../packages/core/src/docs/retained-source.ts'

function markerPreview(text: string, scope: 'listTree' | 'allBlocks' = 'listTree'): MarkerMappingPreview {
  let ordinal = 0
  const preview = previewMarkerMapping(retainSource(text), { authorityEpoch: 7, scope, generateId: () => `generated_${ordinal++}` })
  if ('status' in preview) throw new Error(`Marker preview failed: ${preview.code}`)
  return preview
}
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

describe('LSX-WP-006 stable block anchors', () => {
  test('reads imported Obsidian and ROX anchors with one alias mapping and no content mutation', () => {
    const text = '\uFEFF---\r\nprivate: "<!-- block:not-body -->"\r\n---\r\n<!-- block:root -->\r\n# Title\r\n\r\n<!-- block:rox-one -->\r\n- same quote ^abc\r\n- same quote ^def\r\n'
    const source = retainSource(text), before = source.bytes.slice()
    const projection = projectBlockIdentity(source, { authorityEpoch: 7 })
    expect(projection.status).toBe('ok')
    expect(projection.sourceHash).toBe(source.sourceHash)
    expect(projection.authorityEpoch).toBe(7)
    expect(projection.blocks.map(block => block.nodeId)).toEqual(['root', 'rox-one', 'def'])
    expect(projection.mappings.find(mapping => mapping.blockId === 'abc')).toMatchObject({ nodeId: 'rox-one', kind: 'obsidian', markerMappingVersion: 1 })
    expect(projection.mappings.find(mapping => mapping.blockId === 'rox-one')).toMatchObject({ nodeId: 'rox-one', kind: 'rox' })
    expect(projection.mappings.some(mapping => mapping.blockId === 'not-body')).toBe(false)
    expect(source.bytes).toEqual(before)
    expect(projectBlockIdentity(source, { authorityEpoch: 7 })).toEqual(projection)
    expect(projectBlockIdentity(source, { markerMappingVersion: 999 }).code).toBe('unknownFormat')
  })

  test('existing IDs survive edits, reorder and reload; identical quotes remain distinct nodes', () => {
    const original = '# Title ^title\n- same quote ^first\n- same quote ^second\n'
    const edited = '# Renamed ^title\n- modified quote ^second\n- same quote ^first\n'
    const before = projectListTree(retainSource(original)), after = projectListTree(retainSource(edited))
    expect(before.root?.nodeId).toBe('title')
    expect(after.root?.nodeId).toBe('title')
    expect(before.nodes.map(node => node.nodeId)).toEqual(['first', 'second'])
    expect(after.nodes.map(node => node.nodeId)).toEqual(['second', 'first'])
    expect(after.nodes.find(node => node.nodeId === 'second')?.text).toBe('modified quote')
    expect(projectListTree(retainSource(utf8Bytes(edited))).nodes.map(node => node.nodeId)).toEqual(['second', 'first'])
  })

  test('duplicate aliases/IDs and malformed/multiple/dangling markers are explicit and cannot be silently stamped', () => {
    const duplicate = '# Title\n- one ^duplicate\n<!-- block:duplicate -->\n- two\n'
    const projection = projectBlockIdentity(retainSource(duplicate))
    expect(projection.status).toBe('readOnly')
    expect(projection.code).toBe('conflict')
    expect(projection.diagnostics.some(diagnostic => diagnostic.code === 'duplicateId' && diagnostic.id === 'duplicate')).toBe(true)
    expect(projection.blocks.filter(block => block.kind === 'listItem').map(block => block.identity)).toEqual(['ambiguous', 'ambiguous'])
    expect(projection.blocks.filter(block => block.kind === 'listItem').map(block => block.nodeId)).toEqual([undefined, undefined])
    expect(projection.mappings).toEqual([])
    for (const text of [
      '# Title\n<!-- block: -->\n- item', '# Title\n<!-- block:v2:abc -->\n- item',
      '# Title\n<!-- block:unclosed', '# Title\n- item ^illegal!',
      '<!-- block:first -->\n<!-- block:second -->\n- item', '<!-- block:same -->\n<!-- block:same -->\n- item',
      '# Title\n<!-- block:dangling -->\n',
    ]) {
      const source = retainSource(text), before = source.bytes.slice()
      expect(projectBlockIdentity(source).status).toBe('readOnly')
      expect(previewMarkerMapping(source, { authorityEpoch: 7 })).toMatchObject({ status: 'error' })
      expect(source.bytes).toEqual(before)
    }
  })

  test('code, inline code, unknown extension bodies and frontmatter do not accidentally become anchors/list nodes', () => {
    const text = '---\nfield: "^yaml"\nlist: ["<!-- block:yaml -->"]\n---\n# Title\n\n```md\n- code ^code\n<!-- block:code -->\n```\n\n    - indented code ^indent\n\n:::future\n- unknown node ^hidden\n<!-- block:hidden -->\n:::\n\n<!-- foreign\n<!-- block:comment -->\n-->\n\n- real `<!-- block:literal -->` ^real\n'
    const projection = projectBlockIdentity(retainSource(text)), tree = projectListTree(retainSource(text))
    expect(projection.status).toBe('ok')
    expect(projection.mappings.map(mapping => mapping.blockId)).toEqual(['real'])
    expect(tree.nodes.map(node => node.nodeId)).toEqual(['real'])
    expect(tree.nodes[0]?.text).toBe('real `<!-- block:literal -->`')
    expect(projection.blocks.some(block => block.kind === 'opaque' && block.text.includes('^hidden'))).toBe(true)
    expect(listTreeMarkdown(retainSource(text), tree)).toBe(text)
  })

  test('standalone imported IDs attach to existing blocks while ID-only orphan input remains readonly', () => {
    const text = 'Paragraph with two lines\ncontinued\n^paragraph\n\n```ts\ncode()\n```\n^code-block\n'
    const projection = projectBlockIdentity(retainSource(text))
    expect(projection.status).toBe('ok')
    expect(projection.blocks.map(block => [block.kind, block.nodeId])).toEqual([['paragraph', 'paragraph'], ['code', 'code-block']])
    expect(projectBlockIdentity(retainSource('^orphan')).diagnostics[0]?.code).toBe('orphanMarker')
  })

  test('a trailing ROX comment retains an imported alias, and escaped marker syntax stays literal', () => {
    const text = '- item ^imported <!-- block:canonical -->\n- literal \\<!-- block:literal --> ^real\n'
    const projection = projectBlockIdentity(retainSource(text)), tree = projectListTree(retainSource(text))
    expect(projection.status).toBe('ok')
    expect(projection.mappings.find(mapping => mapping.blockId === 'imported')?.nodeId).toBe('canonical')
    expect(projection.mappings.some(mapping => mapping.blockId === 'literal')).toBe(false)
    expect(tree.nodes.map(node => node.nodeId)).toEqual(['canonical', 'real'])
    expect(tree.nodes[0]?.text).toBe('item')
    expect(tree.nodes[1]?.text).toBe('literal \\<!-- block:literal -->')
  })

  test('new anchors are explicit insertions after frontmatter and preserve all existing source bytes', () => {
    const text = '\uFEFF---\r\n# YAML comment\r\nprivate: !future keep\r\n---\r\n# Заголовок\r\n\r\nParagraph stays outside map.\r\n\r\n- first\r\n  - child ^existing\r\n- second\r\n\r\n| table | cell |\r\n| --- | --- |\r\n| keep | exact |\r\n'
    const source = retainSource(text), tree = projectListTree(source, { authorityEpoch: 7 })
    expect(tree.root?.nodeId).toBeUndefined()
    expect(tree.nodes.map(node => node.identity)).toEqual(['unanchored', 'anchored', 'unanchored'])
    expect(source.text).toBe(text)
    const preview = markerPreview(text)
    expect(preview.addedMarkers.map(marker => marker.id)).toEqual(['generated_0', 'generated_1', 'generated_2'])
    expect(preview.patches.every(patch => patch.start >= source.frontmatter!.end && patch.start === patch.end && patch.expected === '')).toBe(true)
    const applied = applyMarkerMapping(source, preview, 7)
    expect(applied.status).toBe('ok')
    if (applied.status !== 'ok') return
    expectUneditedBytes(source.bytes, applied.bytes, preview)
    expect(applied.text.startsWith(text.slice(0, text.indexOf('# Заголовок')))).toBe(true)
    const reload = projectListTree(retainSource(applied.bytes), { authorityEpoch: 7 })
    expect(reload.root?.nodeId).toBe('generated_0')
    expect(reload.nodes.map(node => node.nodeId)).toEqual(['generated_1', 'existing', 'generated_2'])
    expect(reload.nodes[1]?.parentNodeId).toBe('generated_1')
    const noOp = markerPreview(applied.text)
    expect(noOp.patches).toEqual([])
    expect(applyMarkerMapping(retainSource(applied.bytes), noOp, 7)).toMatchObject({ noOp: true, bytes: applied.bytes, sourceHash: applied.sourceHash })
  })

  test('BOM-only and terminal-no-EOL sources keep their byte shape when explicit markers are inserted', () => {
    for (const text of ['\uFEFF# Title\r\n- item', '\uFEFF', '', '- only item', '\uFEFF- only item']) {
      const source = retainSource(text), preview = markerPreview(text), applied = applyMarkerMapping(source, preview, 7)
      expect(applied.status).toBe('ok')
      if (applied.status !== 'ok') continue
      expectUneditedBytes(source.bytes, applied.bytes, preview)
      if (text.startsWith('\uFEFF')) expect(applied.bytes.slice(0, 3)).toEqual(source.bytes.slice(0, 3))
      if (text.trim().length > 1) expect(applied.text.endsWith(text.slice(text.indexOf('-') >= 0 ? text.indexOf('-') : 0))).toBe(true)
    }
  })

  test('marker apply checks SHA, epoch, purpose digest, exact inserted marker and generated-ID collisions', () => {
    const text = '# Title\n- item ^imported\n- new\n', source = retainSource(text), preview = markerPreview(text)
    expect(applyMarkerMapping(retainSource(`${text}\nexternal`), preview, 7)).toEqual({ status: 'error', code: 'conflict' })
    expect(applyMarkerMapping(source, preview, 8)).toEqual({ status: 'error', code: 'conflict' })
    expect(applyMarkerMapping(source, { ...preview, addedMarkers: preview.addedMarkers.map(marker => ({ ...marker, id: 'tampered' })) }, 7))
      .toEqual({ status: 'error', code: 'validation' })
    const patches = preview.patches.map((patch, index) => index ? patch : { ...patch, replacement: '<!-- block:generated_0 -->\nUNREVIEWED\n' })
    expect(applyMarkerMapping(source, { ...preview, patches, digest: rawSpanPreviewDigest(preview.expectedSourceHash, patches, preview.purpose) }, 7))
      .toEqual({ status: 'error', code: 'validation' })
    expect(previewMarkerMapping(source, { authorityEpoch: 7, generateId: () => 'imported' })).toEqual({ status: 'error', code: 'conflict' })
    expect(previewMarkerMapping(source, { authorityEpoch: 7, generateId: () => 'illegal id!' })).toEqual({ status: 'error', code: 'validation' })
    expect(previewMarkerMapping(source, { authorityEpoch: 7, generateId: () => { throw new Error('unavailable entropy') } })).toEqual({ status: 'error', code: 'validation' })
    expect(previewMarkerMapping(source, { authorityEpoch: 7, expectedSourceHash: retainedSourceHash('stale') })).toEqual({ status: 'error', code: 'conflict' })
  })
})

describe('LSX-WP-006 retained list tree', () => {
  test('projects nested ordered, bullet and checkbox rows with stable parent identity and H1 root', () => {
    const text = '<!-- block:title -->\n# Заголовок\n\n- parent ^parent\n  3. [x] child ^child\n     + grandchild ^grandchild\n  4. [ ] sibling ^sibling\n- last ^last\n'
    const tree = projectListTree(retainSource(text), { authorityEpoch: 7 })
    expect(tree.status).toBe('ok')
    expect(tree.root).toMatchObject({ nodeId: 'title', text: 'Заголовок' })
    expect(tree.roots.map(node => node.nodeId)).toEqual(['parent', 'last'])
    expect(tree.nodes.map(node => node.level)).toEqual([0, 1, 2, 1, 0])
    expect(tree.nodes.map(node => node.parentNodeId)).toEqual(['title', 'parent', 'child', 'parent', 'title'])
    expect(tree.nodes[1]).toMatchObject({ text: 'child', marker: '3.', ordered: true, ordinal: 3, checkbox: true, parentIndex: 0 })
    expect(tree.nodes[3]).toMatchObject({ text: 'sibling', checkbox: false, parentIndex: 0 })
    expect(tree.nodes[0]?.children.map(node => node.nodeId)).toEqual(['child', 'sibling'])
  })

  test('prose/tables/code/unknown blocks form retained regions and export remains exact even when view objects are changed', () => {
    const text = '\uFEFF---\r\nunknown: yes\r\n---\r\n# Root ^root\r\n\r\nProse before.\r\n\r\n- node ^node\r\n  attached prose\r\n\r\n| Table | A |\r\n| --- | --- |\r\n| keep | me |\r\n\r\n~~~text\r\n- not a node\r\n~~~\r\n\r\n:::future\r\nunknown payload\r\n:::\r\ntrailing prose\r\n'
    const source = retainSource(text), tree = projectListTree(source)
    expect(tree.nodes.map(node => node.nodeId)).toEqual(['node'])
    const retained = tree.retainedRegions.map(range => retainedText(source, range)).join('')
    for (const fragment of ['unknown: yes', 'Prose before.', 'attached prose', '| keep | me |', '- not a node', 'unknown payload', 'trailing prose']) {
      expect(retained).toContain(fragment)
    }
    const partition = [...tree.retainedRegions, ...tree.nodes.map(node => node.sourceRange), tree.root!.sourceRange].sort((a, b) => a.start - b.start)
    expect(partition.map(range => retainedText(source, range)).join('')).toBe(text)
    tree.nodes[0]!.text = 'view-only mutation'
    expect(listTreeMarkdown(source, tree)).toBe(text)
    expect(listTreeMarkdown(retainSource(`${text}external`), tree)).toEqual({ status: 'error', code: 'conflict' })
  })

  test('unsupported indentation is readonly; unanchored duplicate text has separate rows and no invented IDs', () => {
    const source = retainSource('- same\n- same\n'), tree = projectListTree(source)
    expect(tree.nodes).toHaveLength(2)
    expect(tree.nodes.map(node => node.nodeId)).toEqual([undefined, undefined])
    expect(tree.nodes[0]?.blockIndex).not.toBe(tree.nodes[1]?.blockIndex)
    expect(source.bytes).toEqual(utf8Bytes('- same\n- same\n'))
    const unsupported = projectListTree(retainSource('- parent ^parent\n - too little indent ^child\n'))
    expect(unsupported.status).toBe('readOnly')
    expect(unsupported.diagnostics.some(diagnostic => diagnostic.code === 'unsupportedIndent')).toBe(true)
  })

  test('generated edit/reorder/reload variants retain literal IDs and source bytes (fixed reproduction seed 006)', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const eol = ['\n', '\r\n', '\r'][seed % 3]!, bom = seed % 2 ? '\uFEFF' : ''
      const rows = Array.from({ length: 2 + seed % 6 }, (_, index) => `- duplicate quote ^id_${index}`)
      const text = `${bom}---${eol}private: !future keep${eol}---${eol}# Title ^title${eol}${rows.join(eol)}${eol}`
      const before = projectListTree(retainSource(text)), expected = before.nodes.map(node => node.nodeId).reverse()
      const edited = `${bom}---${eol}private: !future keep${eol}---${eol}# Renamed ^title${eol}${rows.reverse().map(row => row.replace('duplicate quote', `edited ${seed} 🐈`)).join(eol)}${eol}`
      const source = retainSource(edited), after = projectListTree(source)
      expect(before.status).toBe('ok')
      expect(after.status).toBe('ok')
      expect(after.nodes.map(node => node.nodeId)).toEqual(expected)
      expect(new Set(after.nodes.map(node => node.nodeId)).size).toBe(after.nodes.length)
      expect(after.root?.nodeId).toBe('title')
      expect(listTreeMarkdown(source, after)).toBe(edited)
    }
  }, 30_000)

  test('seeded offset/text-ID negative controls fail stable-ID and distinct-quote assertions', () => {
    const original = '# Title\n- duplicate quote ^first\n- duplicate quote ^second\n'
    const edited = '# Longer renamed title\n- changed quote ^second\n- duplicate quote ^first\n'
    const before = projectListTree(retainSource(original)), after = projectListTree(retainSource(edited))
    const stableOracle = (ids: Array<string | undefined>) => expect(ids).toEqual(['second', 'first'])
    stableOracle(after.nodes.map(node => node.nodeId))
    expect(() => stableOracle(after.nodes.map(node => `offset_${node.sourceRange.start}`))).toThrow()
    expect(() => stableOracle(after.nodes.map(node => retainedSourceHash(node.text)))).toThrow()
    const duplicateTextIds = before.nodes.map(node => retainedSourceHash(node.text))
    expect(() => expect(new Set(duplicateTextIds).size).toBe(before.nodes.length)).toThrow()
  })
})

import { describe, expect, it } from 'bun:test'
import { buildPermissionPreview, lineDiffHunks, PERMISSION_PREVIEW_MAX_CHARS } from '../pre-tool-use.ts'

describe('buildPermissionPreview (#16)', () => {
  it('Edit → one hunk', () => {
    expect(buildPermissionPreview('Edit', { old_string: 'a', new_string: 'b' }, 'f.ts')).toEqual({ kind: 'edit', filePath: 'f.ts', hunks: [{ oldText: 'a', newText: 'b' }] })
  })
  it('MultiEdit → hunks, capped count marks truncated', () => {
    const edits = Array.from({ length: 10 }, (_, i) => ({ old_string: `o${i}`, new_string: `n${i}` }))
    const p = buildPermissionPreview('MultiEdit', { edits }, 'f.ts')
    expect(p?.kind).toBe('edit')
    expect(p && p.kind === 'edit' ? p.hunks.length : 0).toBe(8)
    expect(p?.truncated).toBe(true)
  })
  it('Edit replace_all → carries occurrence count', () => {
    const p = buildPermissionPreview('Edit', { old_string: 'a', new_string: 'b', replace_all: true }, 'f.ts', () => 'a-a-a')
    expect(p && p.kind === 'edit' ? p.replaceAll : -1).toBe(3)
  })
  it('Write over existing file → overwrite with real line diff', () => {
    const p = buildPermissionPreview('Write', { content: 'one\nTWO\nthree\nfour\n' }, 'f.ts', () => 'one\ntwo\nthree\n')
    expect(p).toEqual({ kind: 'overwrite', filePath: 'f.ts', hunks: [{ oldText: 'two', newText: 'TWO' }, { oldText: '', newText: 'four' }] })
  })
  it('lineDiffHunks: identical → no hunks', () => {
    expect(lineDiffHunks('a\nb', 'a\nb')).toEqual([])
  })
  it('Write → capped new text', () => {
    const p = buildPermissionPreview('Write', { content: 'x'.repeat(PERMISSION_PREVIEW_MAX_CHARS + 10) }, 'f.ts', () => null)
    expect(p && p.kind === 'write' ? p.newText.length : 0).toBe(PERMISSION_PREVIEW_MAX_CHARS)
    expect(p?.truncated).toBe(true)
  })
  it('other tools → undefined', () => {
    expect(buildPermissionPreview('NotebookEdit', {}, 'n.ipynb')).toBeUndefined()
  })
})

import { describe, expect, it } from 'bun:test'
import type { SessionFile } from '../../../../shared/types'
import { flattenSessionFileRows, SESSION_FILES_WINDOW_THRESHOLD } from '../SessionFilesSection'

function file(path: string, children?: SessionFile[]): SessionFile {
  return {
    name: path.split('/').pop()!,
    path,
    type: children ? 'directory' : 'file',
    children,
  }
}

describe('flattenSessionFileRows', () => {
  it('omits children of collapsed folders', () => {
    const tree = [file('a', [file('a/1.md'), file('a/2.md')]), file('b.md')]
    const rows = flattenSessionFileRows(tree, new Set())
    expect(rows.map((row) => row.file.path)).toEqual(['a', 'b.md'])
  })

  it('keeps expanded descendants in render order', () => {
    const tree = [file('a', [file('a/1.md'), file('a/nested', [file('a/nested/x.md')])])]
    const rows = flattenSessionFileRows(tree, new Set(['a', 'a/nested']))
    expect(rows.map((row) => row.file.path)).toEqual(['a', 'a/1.md', 'a/nested', 'a/nested/x.md'])
  })

  it('a 500-file expanded tree is above the window threshold', () => {
    const tree = Array.from({ length: 500 }, (_, i) => file(`f${i}.md`))
    const rows = flattenSessionFileRows(tree, new Set())
    expect(rows.length).toBe(500)
    expect(rows.length).toBeGreaterThan(SESSION_FILES_WINDOW_THRESHOLD)
  })
})

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acquireDocumentResizing, RESIZING_ATTRIBUTE } from '../useDocumentResizingFlag'

function fakeRoot() {
  const attrs = new Map<string, string>()
  return {
    attrs,
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
    removeAttribute: (name: string) => void attrs.delete(name),
  }
}

describe('html[data-resizing] flag (UI-A1)', () => {
  it('sets the attribute motion.css keys on, and removes it on release', () => {
    const root = fakeRoot()
    const release = acquireDocumentResizing(root)
    expect(RESIZING_ATTRIBUTE).toBe('data-resizing')
    expect(root.attrs.has('data-resizing')).toBe(true)
    release()
    expect(root.attrs.has('data-resizing')).toBe(false)
  })

  it('is ref-counted across concurrent holders and release is idempotent', () => {
    const root = fakeRoot()
    const a = acquireDocumentResizing(root)
    const b = acquireDocumentResizing(root)
    a()
    a() // double release must not drop b's hold
    expect(root.attrs.has('data-resizing')).toBe(true)
    b()
    expect(root.attrs.has('data-resizing')).toBe(false)
    // Re-acquire after full release works.
    const c = acquireDocumentResizing(root)
    expect(root.attrs.has('data-resizing')).toBe(true)
    c()
  })

  it('is a no-op without a document', () => {
    expect(() => acquireDocumentResizing(null)()).not.toThrow()
  })

  it('the hook releases in its effect cleanup (drag end and unmount)', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'useDocumentResizingFlag.ts'), 'utf8')
    expect(src).toMatch(/React\.useEffect\(\(\) => \{\s*if \(!active\) return\s*return acquireDocumentResizing\(\)\s*\}, \[active\]\)/)
  })

  it('resize hook and sash primitive toggle the flag while dragging', () => {
    const renderer = join(import.meta.dir, '..', '..')
    const hook = readFileSync(join(renderer, 'hooks', 'usePanelResize.ts'), 'utf8')
    const handle = readFileSync(join(renderer, 'components', 'app-shell', 'ResizeHandle.tsx'), 'utf8')
    expect(hook).toContain('useDocumentResizingFlag(dragging)')
    expect(handle).toContain('useDocumentResizingFlag(dragging)')
    const motion = readFileSync(join(renderer, '../../../../packages/ui/src/styles/tokens/motion.css'), 'utf8')
    expect(motion).toContain('html[data-resizing]')
  })
})

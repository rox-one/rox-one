import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../home/glance')

describe('home glance perf boundaries', () => {
  it('view shell does not statically import @dnd-kit', () => {
    const shell = readFileSync(join(root, 'HomeGlanceShell.tsx'), 'utf8')
    const home = readFileSync(join(root, 'GlanceHome.tsx'), 'utf8')
    expect(shell).not.toContain('@dnd-kit')
    // Comments may mention dnd-kit; ensure no import path.
    expect(home).not.toMatch(/from ['"]@dnd-kit\//)
    expect(home).toContain("import('./GlanceHomeEdit')")
  })

  it('edit chunk is the only glance module that imports @dnd-kit', () => {
    const edit = readFileSync(join(root, 'GlanceHomeEdit.tsx'), 'utf8')
    expect(edit).toMatch(/from ['"]@dnd-kit\/core['"]/)
    expect(edit).toMatch(/from ['"]@dnd-kit\/sortable['"]/)
  })

  it('idle-mount helper schedules off-screen mounts', () => {
    const src = readFileSync(join(root, 'idle-mount.ts'), 'utf8')
    expect(src).toContain('requestIdleCallback')
    expect(src).toContain('IntersectionObserver')
    expect(src).toContain('useNearViewport')
  })
})

describe('home overview perf boundaries', () => {
  it('HomeFrontPage view path does not import @dnd-kit', () => {
    const front = readFileSync(join(import.meta.dir, '../HomeFrontPage.tsx'), 'utf8')
    const widgets = readFileSync(join(import.meta.dir, '../home/widgets.tsx'), 'utf8')
    expect(front).not.toMatch(/from ['"]@dnd-kit\//)
    expect(widgets).not.toMatch(/from ['"]@dnd-kit\//)
    expect(front).toContain("import('./home/home-overview-dnd')")
    expect(widgets).toContain("import('./today-tasks-sortable')")
  })
})

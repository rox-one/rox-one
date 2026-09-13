import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const leftSidebar = readFileSync(join(import.meta.dir, '../LeftSidebar.tsx'), 'utf8')
const disclosure = readFileSync(join(import.meta.dir, '../SidebarDisclosure.tsx'), 'utf8')

describe('Zen Shell sidebar disclosure (ZS-04)', () => {
  it('extracts a disclosure primitive with aria-expanded/controls', () => {
    expect(disclosure).toContain('aria-expanded')
    expect(disclosure).toContain('aria-controls')
    expect(disclosure).toContain('sidebar.disclosure.expand')
    expect(disclosure).toContain('sidebar.disclosure.collapse')
    expect(disclosure).toContain('data-no-dnd="true"')
  })

  it('uses sibling navigation + disclosure for navigable parents', () => {
    expect(leftSidebar).toContain('SidebarDisclosureButton')
    expect(leftSidebar).toContain('isNavigableExpandable')
    expect(leftSidebar).toContain('role="none"')
    expect(leftSidebar).toContain('restoreFocusToToggle')
  })

  it('does not nest a clickable span inside the nav button', () => {
    expect(leftSidebar).not.toMatch(/group-hover:opacity-0[\s\S]*link\.onToggle/)
    expect(leftSidebar).not.toContain('rotate-90')
  })
})

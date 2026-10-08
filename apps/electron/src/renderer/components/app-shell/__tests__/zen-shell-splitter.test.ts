import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as ts from 'typescript'

function parseComponent(name: string) {
  const path = join(import.meta.dir, `../${name}.tsx`)
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function descendants(node: ts.Node): ts.Node[] {
  const children: ts.Node[] = []
  ts.forEachChild(node, (child) => { children.push(child, ...descendants(child)) })
  return children
}

function attribute(node: ts.JsxOpeningLikeElement, name: string) {
  return node.attributes.properties.find((property): property is ts.JsxAttribute =>
    ts.isJsxAttribute(property) && property.name.getText() === name)
}

describe('Zen Shell splitter wiring (ZS-05)', () => {
  it('uses ResizeHandle and pointer capture rather than document mousemove', () => {
    const sash = readFileSync(join(import.meta.dir, '../PanelResizeSash.tsx'), 'utf8')
    const appShell = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')
    expect(sash).toContain('usePanelResize')
    expect(sash).toContain('neighborChanged')
    expect(appShell).toContain('labelKey="shell.resize.sidebar"')
    expect(appShell).toContain('labelKey="shell.resize.navigator"')
    expect(appShell).not.toMatch(/document\.addEventListener\('mousemove', handleMouseMove\)/)
  })

  it('keeps shell separators in the same scrolling coordinate owner as their panel seams', () => {
    const app = parseComponent('AppShell')
    const handles = descendants(app).filter((node): node is ts.JsxSelfClosingElement =>
      ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'ResizeHandle')
    expect(handles).toHaveLength(2)
    for (const handle of handles) {
      let slot: ts.Node | undefined = handle.parent
      while (slot && !(ts.isJsxAttribute(slot) && slot.name.getText() === 'resizeHandles')) slot = slot.parent
      if (!slot) throw new Error('Shell separator is outside the scrolling panel stack slot')
      const stack = slot.parent.parent
      expect(ts.isJsxSelfClosingElement(stack) && stack.tagName.getText()).toBe('PanelStackContainer')
      expect(attribute(handle, 'style')?.getText()).not.toContain('unifiedRailOffset')
    }

    const container = parseComponent('PanelStackContainer')
    const slot = descendants(container).find((node) =>
      ts.isJsxExpression(node) && node.expression?.getText() === 'resizeHandles')
    const owner = slot?.parent
    if (!owner || !ts.isJsxElement(owner)) throw new Error('Separators have no shared JSX coordinate owner')
    expect(owner.openingElement.tagName.getText()).toBe('motion.div')
    expect(attribute(owner.openingElement, 'className')?.initializer?.getText()).toContain('relative')
    const siblings = owner.children.filter(ts.isJsxElement)
    const panelRoles = siblings.map((node) => attribute(node.openingElement, 'data-panel-role')?.initializer?.getText())
    expect(panelRoles).toContain('"sidebar"')
    expect(panelRoles).toContain('"navigator"')
    const scrollOwner = owner.parent
    if (!ts.isJsxElement(scrollOwner)) throw new Error('Shared coordinate owner is outside the overflow viewport')
    expect(attribute(scrollOwner.openingElement, 'style')?.getText()).toContain("overflowX: isCompact ? 'hidden' : 'auto'")
  })
})

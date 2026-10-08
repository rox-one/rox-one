import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as ts from 'typescript'

/**
 * UI-A1 review3: the workspace creation / reconnect screen is a fullscreen
 * overlay (--z-fullscreen 120). Opened from the compact craft-menu Drawer
 * (scrim 200 / modal 210) it must not end up behind that Drawer, so the
 * header hosts the flow (the screen outlives the Drawer) and closes the
 * Drawer when the screen opens — for both new-workspace and reconnect.
 */
function parse(name: string) {
  const path = join(import.meta.dir, `../${name}.tsx`)
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function descendants(node: ts.Node): ts.Node[] {
  const out: ts.Node[] = []
  ts.forEachChild(node, (child) => { out.push(child, ...descendants(child)) })
  return out
}

function fn(file: ts.SourceFile, name: string): ts.Node {
  const found = descendants(file).find((n) =>
    (ts.isFunctionDeclaration(n) && n.name?.text === name) ||
    (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name))
  if (!found) throw new Error(`missing ${name}`)
  return found
}

function jsxAncestors(node: ts.Node): string[] {
  const tags: string[] = []
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxElement(p)) tags.push(p.openingElement.tagName.getText())
  }
  return tags
}

describe('workspace creation from the compact craft-menu Drawer', () => {
  const header = parse('PanelHeader')
  const compact = fn(header, 'CompactChatHeader')
  const menu = parse('AccountMenu')

  it('the header owns the creation flow and renders its screen outside the Drawer', () => {
    const text = compact.getText()
    expect(text).toContain('useWorkspaceCreationFlow(')
    const screen = descendants(compact).find((n) => ts.isJsxExpression(n) && n.expression?.getText() === 'creationFlow.screen')
    expect(screen).toBeDefined()
    const ancestors = jsxAncestors(screen!)
    expect(ancestors).not.toContain('Drawer')
    expect(ancestors).not.toContain('DrawerContent')
  })

  it('passes the hosted flow to AccountMenu and closes the Drawer when the screen opens', () => {
    const accountMenu = descendants(compact).find((n): n is ts.JsxSelfClosingElement =>
      ts.isJsxSelfClosingElement(n) && n.tagName.getText() === 'AccountMenu')!
    expect(jsxAncestors(accountMenu)).toContain('DrawerContent')
    const attr = (name: string) => accountMenu.attributes.properties.find((p): p is ts.JsxAttribute =>
      ts.isJsxAttribute(p) && p.name.getText() === name)
    expect(attr('creationFlow')?.initializer?.getText()).toBe('{creationFlow}')
    expect(attr('onOpenCreationScreen')?.initializer?.getText()).toBe('{() => setMenuOpen(false)}')
    expect(attr('compact')).toBeDefined()
  })

  it('AccountMenu routes new-workspace and both reconnect paths through openCreationScreen', () => {
    const open = fn(menu, 'openCreationScreen').getText()
    expect(open).toContain('creationFlow.open(reconnectWorkspace)')
    expect(open).toContain('onOpenCreationScreen?.()')
    expect(fn(menu, 'handleNewWorkspace').getText()).toContain('openCreationScreen()')
    expect(fn(menu, 'selectWorkspace').getText()).toContain('openCreationScreen(workspace)')
    // Desktop dropdown reconnect path.
    const src = menu.getFullText()
    expect((src.match(/openCreationScreen\(workspace\)/g) ?? []).length).toBe(2)
    // Creation state is only toggled inside the hook.
    const hook = fn(menu, 'useWorkspaceCreationFlow').getText()
    const outsideHook = src.replace(hook, '')
    expect(outsideHook).not.toContain('setShowCreationScreen(')
    expect(outsideHook).not.toContain('setReconnectTarget(')
  })

  it('a hosted flow is rendered by its host only (no second screen inside the menu)', () => {
    const src = menu.getFullText()
    expect(src).toContain('const creationFlow = hostedCreationFlow ?? ownCreationFlow')
    expect(src).toContain('const creationScreen = hostedCreationFlow ? null : ownCreationFlow.screen')
    const hook = fn(menu, 'useWorkspaceCreationFlow').getText()
    expect(hook).toContain('<WorkspaceCreationScreen')
    expect(hook).toMatch(/useEffect\(\(\) => \(\) => \{\s*if \(showingRef\.current\) setFullscreenOverlayOpen\(false\)/)
  })
})

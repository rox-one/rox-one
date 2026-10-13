import { describe, expect, it } from 'bun:test'
import * as schema from '../../../../shared/menu-schema'
import { buildMobileMenuPages } from '../mobile-menu-pages'
import { MENU_ICONS, getMenuIcon } from '../menu-icons'

function collectIconNames(value: unknown, names: Set<string>, seen = new Set<unknown>()): Set<string> {
  if (!value || typeof value !== 'object' || seen.has(value)) return names
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) collectIconNames(item, names, seen)
    return names
  }
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'icon' || key === 'iconName') && typeof child === 'string') names.add(child)
    else collectIconNames(child, names, seen)
  }
  return names
}

describe('menu icon map', () => {
  it('resolves every lucide icon name used by the menu schema and mobile pages', () => {
    const names = collectIconNames(Object.values(schema), new Set())
    collectIconNames(buildMobileMenuPages({ hasNewWindow: true, isDebugMode: true, isWeb: false }), names)
    expect(names.size).toBeGreaterThan(10)
    const missing = [...names].filter(name => !getMenuIcon(name))
    expect(missing).toEqual([])
  })

  it('drops the update/devtools debug surface on the web host', () => {
    const desktop = buildMobileMenuPages({ hasNewWindow: false, isDebugMode: true, isWeb: false })
    const web = buildMobileMenuPages({ hasNewWindow: false, isDebugMode: true, isWeb: true })
    expect(desktop.some(page => page.id === 'debug')).toBe(true)
    expect(web.some(page => page.id === 'debug')).toBe(false)
    expect(web.flatMap(page => page.rows).some(row => row.action.kind === 'electronApi')).toBe(false)
    expect(web.find(page => page.id === 'root')?.rows.some(row => row.id === 'debug')).toBe(false)
  })

  it('does not resolve prototype keys or non-strings', () => {
    expect(getMenuIcon('constructor')).toBeNull()
    expect(getMenuIcon('toString')).toBeNull()
    expect(getMenuIcon(undefined)).toBeNull()
    expect(Object.keys(MENU_ICONS)).toContain('SquarePen')
  })
})

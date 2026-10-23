import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  sePanelMeasureActive,
  sePanelMeasureBleed,
} from '../panel-constants'

const root = join(import.meta.dir, '../../../../../../..')
const slot = readFileSync(join(root, 'apps/electron/src/renderer/components/app-shell/PanelSlot.tsx'), 'utf8')
const helper = readFileSync(join(root, 'apps/electron/src/renderer/components/app-shell/panel-constants.ts'), 'utf8')
const css = readFileSync(join(root, 'apps/electron/src/renderer/index.css'), 'utf8')
const seUltra = css.slice(css.indexOf('/* Rox Engineering ultra-wide / fluid shell.'))
const primEnd = css.indexOf('/* Rox Engineering shell micro-interactions')
const prim = css.slice(css.indexOf('.rox-panel-gutter {'), primEnd < 0 ? undefined : primEnd)

describe('SE panel measure wire', () => {
  it('PanelSlot attaches #2054 primitives under SE via sePanelMeasureActive', () => {
    expect(slot).toContain('useSuperEngineeringProfile')
    expect(slot).toContain('sePanelMeasureActive')
    expect(slot).toContain('rox-panel-gutter')
    expect(slot).toContain('rox-panel-measure')
    expect(slot).toContain('data-se-panel-measure')
    expect(helper).toContain("navigator === 'home'")
    expect(helper).toContain("navigator === 'tasks'")
    expect(helper).toContain('messenger')
    expect(helper).toContain('calendar')
    expect(helper).toContain('canvas')
  })

  it('activates only for SE non-bleed content panels', () => {
    expect(sePanelMeasureActive(true, { navigator: 'settings' })).toBe(true)
    expect(sePanelMeasureActive(true, { navigator: 'notes' })).toBe(true)
    expect(sePanelMeasureActive(false, { navigator: 'settings' })).toBe(false)
    expect(sePanelMeasureActive(true, { navigator: 'settings' }, { tool: true })).toBe(false)

    expect(sePanelMeasureBleed({ navigator: 'home' })).toBe(true)
    expect(sePanelMeasureBleed({ navigator: 'tasks' })).toBe(true)
    expect(sePanelMeasureBleed({ navigator: 'surface', surface: 'messenger' })).toBe(true)
    expect(sePanelMeasureBleed({ navigator: 'surface', surface: 'calendar' })).toBe(true)
    expect(sePanelMeasureBleed({ navigator: 'surface', surface: 'canvas' })).toBe(true)
    expect(sePanelMeasureActive(true, { navigator: 'home' })).toBe(false)
    expect(sePanelMeasureActive(true, { navigator: 'tasks' })).toBe(false)
    expect(sePanelMeasureActive(true, { navigator: 'surface', surface: 'messenger' })).toBe(false)
    expect(sePanelMeasureActive(true, { navigator: 'surface', surface: 'calendar' })).toBe(false)
    expect(sePanelMeasureActive(true, { navigator: 'surface', surface: 'canvas' })).toBe(false)
    expect(sePanelMeasureActive(true, { navigator: 'surface', surface: 'goals' })).toBe(true)
  })

  it('keeps #2199 ultra-wide SE bands retargeting panel-gutter/measure tokens', () => {
    expect(seUltra).toContain('html[data-ui-profile="super-engineering"]')
    expect(seUltra).toContain('[data-shell-band="wide"]')
    expect(seUltra).toContain('[data-shell-band="ultra"]')
    expect(seUltra).toContain('--panel-gutter: calc(var(--spacing) * 10);')
    expect(seUltra).toContain('--panel-gutter: calc(var(--spacing) * 14);')
    expect(seUltra).toContain('--panel-measure: 1120px;')
    expect(seUltra).toContain('--panel-measure: 1280px;')
  })

  it('does not add transitions on the #2054 primitives', () => {
    expect(prim.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/transition|animation|@keyframes/)
  })
})

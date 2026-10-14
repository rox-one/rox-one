import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { renderToStaticMarkup } from 'react-dom/server'
import { FxGate, resolveFxMode, type FxModeInputs } from '../FxGate'
import { __resetFxSlots, acquireFxSlot, FX_LIMITS, fxSlotsInUse, releaseFxSlot } from '../fx-budget'
import { isFxLevel, readFxLevel } from '../fx-level'

const base: FxModeInputs = {
  level: 'full', kind: 'canvas', reducedMotion: false, batterySaver: false,
  visible: true, onScreen: true, webgl2: true, hasSlot: true,
}

describe('resolveFxMode', () => {
  it('animates only when everything allows it', () => {
    expect(resolveFxMode(base)).toBe('live')
  })
  it('setting off → plain fallback', () => {
    expect(resolveFxMode({ ...base, level: 'off' })).toBe('fallback')
  })
  it('reduced setting, OS reduced motion, battery saver, hidden window, off-screen → static frame', () => {
    expect(resolveFxMode({ ...base, level: 'reduced' })).toBe('static')
    expect(resolveFxMode({ ...base, reducedMotion: true })).toBe('static')
    expect(resolveFxMode({ ...base, batterySaver: true })).toBe('static')
    expect(resolveFxMode({ ...base, visible: false })).toBe('static')
    expect(resolveFxMode({ ...base, onScreen: false })).toBe('static')
  })
  it('no WebGL2 → fallback for webgl effects only', () => {
    expect(resolveFxMode({ ...base, kind: 'webgl', webgl2: false })).toBe('fallback')
    expect(resolveFxMode({ ...base, kind: 'canvas', webgl2: false })).toBe('live')
  })
  it('no concurrency slot → fallback', () => {
    expect(resolveFxMode({ ...base, hasSlot: false })).toBe('fallback')
  })
})

describe('fx budget', () => {
  afterEach(() => __resetFxSlots())
  it('caps WebGL at 1 and canvas at 3', () => {
    expect(FX_LIMITS.webgl).toBe(1)
    expect(FX_LIMITS.canvas).toBe(3)
    const a = Symbol(), b = Symbol()
    expect(acquireFxSlot('webgl', a)).toBe(true)
    expect(acquireFxSlot('webgl', b)).toBe(false)
    releaseFxSlot('webgl', a)
    expect(acquireFxSlot('webgl', b)).toBe(true)
    const c = [Symbol(), Symbol(), Symbol(), Symbol()]
    expect(c.map((s) => acquireFxSlot('canvas', s))).toEqual([true, true, true, false])
    expect(fxSlotsInUse('canvas')).toBe(3)
  })
})

describe('fx level', () => {
  it('validates and defaults to full', () => {
    expect(isFxLevel('reduced')).toBe(true)
    expect(isFxLevel('fast')).toBe(false)
    expect(readFxLevel()).toBe('full')
  })
})

describe('FxGate SSR', () => {
  it('renders the static fallback before a slot is granted (no effect in markup)', () => {
    const html = renderToStaticMarkup(
      <FxGate kind="canvas" fallback={<i>static</i>}>{() => <b>live</b>}</FxGate>,
    )
    expect(html).toContain('<i>static</i>')
    expect(html).not.toContain('<b>live</b>')
    expect(html).toContain('data-fx-mode="fallback"')
  })
})

describe('bundle hygiene', () => {
  it('thinking-orbs is only reached through a dynamic import', () => {
    const src = readFileSync(join(import.meta.dir, '../ThinkingOrbFx.tsx'), 'utf8')
    expect(src).toContain("import('thinking-orbs')")
    expect(src).not.toMatch(/^import\s+(?!type\b)[^\n]*from 'thinking-orbs'/m)
  })
})

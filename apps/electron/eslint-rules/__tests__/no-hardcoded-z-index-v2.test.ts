import { describe, expect, it } from 'bun:test'
import { ids, runRoxRule } from './helpers/run-rox-rule'

const run = (code: string, options?: unknown) => runRoxRule('no-hardcoded-z-index', code, { options })

describe('rox/no-hardcoded-z-index v2: class strings', () => {
  it('flags numeric z-N classes with variants, important and negative forms', () => {
    const messages = run(`
      const a = <div className="z-50" />
      const b = <div className="md:hover:z-10 !z-0 -z-10 z-20!" />
    `)
    expect(ids(messages)).toEqual(['numericClass', 'numericClass', 'numericClass', 'numericClass', 'numericClass'])
  })

  it('flags arbitrary z-[n] classes', () => {
    const messages = run(`const a = cn('z-[60]', 'z-[9999]', 'z-(--my-z)')`)
    expect(ids(messages)).toEqual(['arbitraryClass', 'arbitraryClass', 'arbitraryClass'])
  })

  it('flags retired or unknown z names (they generate no CSS)', () => {
    const messages = run(`const a = <div className="z-overlay z-floating-menu z-dropdown z-max" />`)
    expect(ids(messages)).toEqual(['unknownLayerClass', 'unknownLayerClass', 'unknownLayerClass', 'unknownLayerClass'])
  })

  it('flags deprecated alias vars inside arbitrary z classes once', () => {
    const messages = run(`const a = <div className="z-[var(--z-floating-menu)]" />`)
    expect(ids(messages)).toEqual(['deprecatedAlias'])
  })

  it('allows every A1 layer utility, z-auto, and arbitrary values built on a layer', () => {
    const layers = ['base', 'raised', 'sticky', 'chrome', 'sash', 'popover', 'scrim', 'modal', 'toast',
      'fullscreen', 'menu-backdrop', 'island', 'island-popover', 'tooltip', 'splash']
    const messages = run(`
      const a = <div className="${layers.map((l) => `z-${l}`).join(' ')} z-auto md:z-popover" />
      const b = cn('z-[var(--z-island)]', 'z-[calc(var(--z-chrome)+1)]', 'z-(--z-tooltip)')
    `)
    expect(messages).toHaveLength(0)
  })

  it('skips dynamic template pieces and non-class strings', () => {
    const messages = run('const a = <div className={`z-${layer}`} />; const label = "z-50"; const el = <i title="z-10" />')
    expect(messages).toHaveLength(0)
  })

  it('reports z classes in cva/tv variants and *ClassName props', () => {
    const messages = run(`
      const v = cva('relative', { variants: { lift: { on: 'z-10', off: 'z-popover' } } })
      const el = <Drawer overlayClassName="z-[200]" />
    `)
    expect(ids(messages)).toEqual(['numericClass', 'arbitraryClass'])
  })
})

describe('rox/no-hardcoded-z-index v2: deprecated aliases and style objects', () => {
  it('flags deprecated alias vars in style objects and constants', () => {
    const messages = run(`
      const a = <Menu style={{ zIndex: 'var(--z-floating-menu, 400)' }} />
      const B = 'calc(var(--z-overlay) + 1)'
      const c = \`var(--z-local)\`
    `)
    expect(ids(messages)).toEqual(['deprecatedAlias', 'deprecatedAlias', 'deprecatedAlias'])
    expect(messages[0]?.message).toContain('var(--z-island)')
    expect(messages[1]?.message).toContain('var(--z-fullscreen)')
  })

  it('does not confuse layer names that share an alias prefix', () => {
    // --z-island-popover is a layer; --z-island-overlay is an alias.
    const messages = run(`const a = { zIndex: 'var(--z-island-popover)' }; const b = 'var(--z-island-overlay)'`)
    expect(ids(messages)).toEqual(['deprecatedAlias'])
  })

  it('keeps the v1 style checks by default', () => {
    const messages = run(`const s = { zIndex: 400 }; el.style.zIndex = '9999'; function C({ zIndex = 5 }) {}`)
    expect(ids(messages)).toEqual(['noHardcodedZIndex', 'noHardcodedZIndex', 'noHardcodedZIndex'])
  })

  it('checkStyle: false leaves style literals to craft-styles (no double count)', () => {
    const messages = run(`const s = { zIndex: 400 }; const c = cn('z-10')`, { checkStyle: false })
    expect(ids(messages)).toEqual(['numericClass'])
  })
})

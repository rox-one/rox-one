import { describe, expect, it } from 'bun:test'
import { ids, runRoxRule } from './helpers/run-rox-rule'

const run = (code: string) => runRoxRule('prefer-primitives', code)

describe('rox/prefer-primitives', () => {
  it('flags native select, raw checkbox and role="tab"', () => {
    const messages = run(`
      const a = <select value={v}><option>a</option></select>
      const b = <input type="checkbox" checked={on} />
      const c = <input type={'checkbox'} />
      const d = <button role="tab" aria-selected>Tab</button>
    `)
    expect(ids(messages)).toEqual(['nativeSelect', 'rawCheckbox', 'rawCheckbox', 'roleTab'])
  })

  it('flags title={t(...)} on buttons and *Button components', () => {
    const messages = run(`
      const a = <button title={t('actions.close')}>x</button>
      const b = <IconButton title={i18n.t('actions.open')} />
    `)
    expect(ids(messages)).toEqual(['titleTooltip', 'titleTooltip'])
  })

  it('flags hand-rolled fixed inset-0 overlays once per class string', () => {
    const messages = run(`
      const a = <div className="fixed inset-0 z-modal bg-black/40" />
      const b = cn('fixed', 'inset-0')
    `)
    expect(ids(messages)).toEqual(['fixedOverlay'])
  })

  it('allows primitives and unrelated markup', () => {
    const messages = run(`
      const a = <Select value={v} />
      const b = <input type="text" />
      const c = <div role="tablist" />
      const d = <button title="Close">x</button>
      const e = <span title={t('x')} />
      const f = <div className="md:fixed inset-0" />
      const g = <div className="fixed inset-x-0 bottom-0" />
    `)
    expect(messages).toHaveLength(0)
  })
})

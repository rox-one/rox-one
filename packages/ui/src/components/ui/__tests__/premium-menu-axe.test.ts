import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const dir = join(import.meta.dir, '..')
const menu = readFileSync(join(dir, 'PremiumMenu.tsx'), 'utf8')
const select = readFileSync(join(dir, 'PremiumMenuSelect.tsx'), 'utf8')

describe('premium menu axe source contract', () => {
  it('wires listbox/option ARIA and focus return', () => {
    expect(menu).toContain('role="listbox"')
    expect(menu).toContain('role="option"')
    expect(menu).toContain('aria-selected={selected}')
    expect(menu).toContain('aria-activedescendant=')
    expect(menu).toContain('aria-controls={LIST_ID}')
    expect(menu).toContain('aria-autocomplete="list"')
    expect(menu).toContain('id={`premium-menu-option-${item.id}`}')
    expect(menu).toContain('previousFocusRef.current?.focus()')
    expect(menu).toContain('scrollTopToRevealIndex')
    expect(menu).toContain('reduceMenuKey')
    expect(menu).toContain('handleTypeahead')
    expect(menu).toContain('searchable')
    expect(menu).toContain('tokens.surfaceClass')
  })

  it('keeps typeahead on the list when search is off', () => {
    expect(menu).toContain('if (searchable) return')
    expect(menu).toContain('typeaheadIndex')
    expect(menu).toContain("tabIndex={searchable ? -1 : 0}")
  })

  it('exposes a compact select trigger with listbox semantics', () => {
    expect(select).toContain('aria-haspopup="listbox"')
    expect(select).toContain('aria-expanded={open}')
    expect(select).toContain('aria-label={ariaLabel ?? placeholder}')
    expect(select).toContain('searchable ?? items.length > 12')
    expect(select).toContain('variant = \'compact\'')
  })
})

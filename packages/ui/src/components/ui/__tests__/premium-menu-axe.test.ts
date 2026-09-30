import { describe, expect, it } from 'bun:test'
import { auditPremiumMenuAxe } from '../premium-menu-model'

describe('premium menu accessibility audit', () => {
  it('accepts a keyboard-focused list with one selected enabled option', () => {
    expect(auditPremiumMenuAxe({
      listbox: {
        role: 'listbox',
        ariaActivedescendant: 'premium-menu-option-edit',
        tabIndex: 0,
      },
      search: {
        role: 'searchbox',
        ariaControls: 'premium-menu-options',
        ariaAutocomplete: 'list',
      },
      options: [
        { id: 'premium-menu-option-edit', role: 'option', ariaSelected: true },
        { id: 'premium-menu-option-delete', role: 'option', ariaSelected: false },
      ],
    })).toEqual([])
  })

  it('rejects ambiguous option identity and simultaneous selection', () => {
    expect(auditPremiumMenuAxe({
      listbox: {
        role: 'listbox',
        ariaActivedescendant: 'premium-menu-option-edit',
        tabIndex: 0,
      },
      options: [
        { id: 'premium-menu-option-edit', role: 'option', ariaSelected: true },
        { id: 'premium-menu-option-edit', role: 'option', ariaSelected: true },
      ],
    })).toEqual([
      'duplicate-id:premium-menu-option-edit',
      'multiple-aria-selected',
    ])
  })

  it('rejects a focused option removed from the available list', () => {
    expect(auditPremiumMenuAxe({
      listbox: {
        role: 'listbox',
        ariaActivedescendant: 'premium-menu-option-removed',
        tabIndex: 0,
      },
      options: [{ id: 'premium-menu-option-current', role: 'option', ariaSelected: false }],
    })).toContain('activedescendant-missing-target')
  })
})

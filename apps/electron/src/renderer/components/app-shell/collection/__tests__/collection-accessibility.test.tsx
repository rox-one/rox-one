import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CollectionMenuDisclosure, CollectionMenuRadioRow, CollectionMenuRow } from '../collection-menu-row'
import { CollectionDisplayToggleRow } from '../CollectionDisplayPopover'

describe('collection selection accessibility', () => {
  it('display toggles use the actual switch as the only arrow and Tab navigation target', () => {
    const html = renderToStaticMarkup(<CollectionDisplayToggleRow label="Show completed" checked onCheckedChange={() => {}} />)
    const label = html.match(/<label\b[^>]*>/)?.[0] ?? ''
    const button = html.match(/<button\b[^>]*>/)?.[0] ?? ''
    const id = button.match(/\bid="([^"]+)"/)?.[1]
    expect(id).toBeDefined()
    expect(label).toContain(`for="${id}"`)
    expect(label).not.toContain('tabindex')
    expect(label).not.toContain('data-collection-dialog-item')
    expect(button).toContain('role="switch"')
    expect(button).toContain('aria-checked="true"')
    expect(button).toContain('data-collection-dialog-item="true"')
    expect(button).not.toContain('tabindex="-1"')
    expect(html.match(/data-collection-dialog-item=/g)).toHaveLength(1)
  })

  for (const Component of [CollectionMenuRow, CollectionMenuRadioRow]) {
    it(`${Component.name}: dialog buttons expose pressed state instead of unsupported checked state`, () => {
      for (const selected of [true, false]) {
        const html = renderToStaticMarkup(<Component role="dialog" selected={selected} label="Compact" onClick={() => {}} />)
        expect(html).toContain(`aria-pressed="${selected}"`)
        expect(html).not.toContain('aria-checked=')
        expect(html).toContain('data-collection-dialog-item="true"')
      }
    })

    it(`${Component.name}: actual menu items retain checked semantics`, () => {
      const html = renderToStaticMarkup(<Component selected label="Compact" onClick={() => {}} />)
      expect(html).toContain('aria-checked="true"')
      expect(html).not.toContain('aria-pressed=')
      expect(html).toContain('role="menuitem')
    })
  }

  it('expanded disclosure owns and names its content', () => {
    const html = renderToStaticMarkup(<CollectionMenuDisclosure label="Density" valueLabel="Compact" defaultOpen><button>Comfortable</button></CollectionMenuDisclosure>)
    const controlled = html.match(/aria-controls="([^"]+)"/)?.[1]
    const labelled = html.match(/aria-labelledby="([^"]+)"/)?.[1]
    expect(controlled).toBeDefined()
    expect(labelled).toBeDefined()
    expect(html).toContain(`id="${controlled}" role="group"`)
    expect(html).toContain(`id="${labelled}" aria-expanded="true"`)
  })

  it('collapsed disclosure does not leave its children in the keyboard or accessibility tree', () => {
    const html = renderToStaticMarkup(<CollectionMenuDisclosure label="Density" valueLabel="Compact"><button>Comfortable</button></CollectionMenuDisclosure>)
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('aria-controls=')
    expect(html).not.toContain('Comfortable')
  })
})

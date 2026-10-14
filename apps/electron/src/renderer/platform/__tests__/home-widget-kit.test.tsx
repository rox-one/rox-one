import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Ring, Sparkline } from '../home/widget-kit'

describe('home widget kit visuals', () => {
  it('Ring clamps progress and exposes an accessible label', () => {
    const html = renderToStaticMarkup(<Ring value={1.7} label="Focus"><span>12:00</span></Ring>)
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Focus"')
    expect(html).toContain('data-home-ring="100"')
    expect(html).toContain('12:00')
    expect(renderToStaticMarkup(<Ring value={Number.NaN} label="x" />)).toContain('data-home-ring="0"')
    expect(renderToStaticMarkup(<Ring value={-1} label="x" />)).toContain('data-home-ring="0"')
  })
  it('Sparkline plots real values and stays flat for all-zero data', () => {
    const html = renderToStaticMarkup(<Sparkline values={[0, 2, 4]} label="Spend" />)
    expect(html).toContain('aria-label="Spend"')
    expect(html).toContain('points="0,28 50,16 100,4"')
    expect(renderToStaticMarkup(<Sparkline values={[0, 0]} label="s" />)).toContain('points="0,28 100,28"')
    expect(renderToStaticMarkup(<Sparkline values={[3]} label="s" />)).not.toContain('<polygon')
  })
})

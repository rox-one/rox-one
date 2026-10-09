import { describe, expect, it } from 'bun:test'
import { ids, runRoxRule } from './helpers/run-rox-rule'

const run = (code: string, filename = 'Component.tsx') => runRoxRule('no-raw-color', code, { filename })

describe('rox/no-raw-color', () => {
  it('flags Tailwind palette classes for every colour utility', () => {
    const messages = run(`const a = <div className="bg-red-500 text-zinc-400/60 border-t-blue-200 ring-emerald-300 fill-sky-50 stroke-rose-950 hover:bg-amber-100" />`)
    expect(ids(messages)).toEqual(Array(7).fill('paletteClass'))
  })

  it('flags literal colours inside arbitrary classes', () => {
    expect(ids(run(`const a = cn('bg-[#1e1e1e]', 'text-[rgb(0_0_0)]', 'border-[hsl(0,0%,50%)]/50')`)))
      .toEqual(['arbitraryClass', 'arbitraryClass', 'arbitraryClass'])
  })

  it('flags literal colours in colour style keys and SVG attributes', () => {
    const messages = run(`
      const s = { color: '#fff', backgroundColor: 'rgba(0,0,0,.5)', border: '1px solid #333' }
      const el = <svg><path fill="#000" stroke={'#abc'} /></svg>
    `)
    expect(ids(messages)).toEqual(Array(5).fill('literal'))
  })

  it('flags bare colour string literals in .tsx files but not in .ts files', () => {
    const code = `const PALETTE = ['#ff00aa', 'oklch(0.7 0.1 200)']`
    expect(ids(run(code))).toEqual(['literal', 'literal'])
    expect(run(code, 'palette.ts')).toHaveLength(0)
  })

  it('reports each style literal once', () => {
    expect(run(`const s = { color: '#fff' }`)).toHaveLength(1)
  })

  it('allows semantic tokens, vars and keywords', () => {
    const messages = run(`
      const a = <div className="bg-accent text-muted-foreground text-status-danger bg-[var(--surface-popover)] border-border-subtle bg-white text-black" />
      const s = { color: 'var(--foreground)', background: 'color-mix(in oklch, var(--a) 10%, transparent)', fill: 'currentColor' }
      const href = '#section-2'
    `)
    expect(messages).toHaveLength(0)
  })
})
